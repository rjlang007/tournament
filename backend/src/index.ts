import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import path from "path";
import { prisma } from "./lib/prisma";
import { initSocket, broadcastTournamentUpdate } from "./socket";
import { computeLeaderboard } from "./lib/leaderboard";

import { tournamentsRouter } from "./routes/tournaments";
import { playersRouter } from "./routes/players";
import { courtsRouter } from "./routes/courts";
import { gamesRouter } from "./routes/games";
import { queueRouter } from "./routes/queue";
import { leaderboardRouter } from "./routes/leaderboard";
import { bracketRouter } from "./routes/bracket";
import { authRouter } from "./routes/auth";
import { accountsRouter } from "./routes/accounts";
import { billingRouter } from "./routes/billing";
import { rafflesRouter } from "./routes/raffles";
import { attachUser, requireAuth, canManageTournament, AuthedRequest } from "./lib/auth";

const app = express();
app.use(cors({
  origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/billing", billingRouter);
app.use("/api/raffles", rafflesRouter);

app.post("/api/players/join", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  if (!req.userId) return res.status(401).json({ error: "Not signed in." });
  const { tournamentId, name, skillLevel, contact } = req.body;
  if (!tournamentId || typeof name !== "string" || name.trim().length < 2 || name.trim().length > 80 || !["BEGINNER", "AVERAGE", "ADVANCE"].includes(skillLevel)) {
    return res.status(400).json({ error: "Your display name and a valid skill level are required" });
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { username: true, role: true } });
  if (!user || user.role !== "PLAYER") return res.status(403).json({ error: "Only player accounts can join tournaments." });
  const existing = await prisma.player.findUnique({ where: { tournamentId_userId: { tournamentId, userId: req.userId } } });
  if (existing) return res.status(409).json({ error: "You already joined this tournament." });
  const player = await prisma.player.create({ data: { tournamentId, userId: req.userId, name: name.trim(), contact, skillLevel, joinStatus: "PENDING" } });
  broadcastTournamentUpdate(tournamentId, "players:changed");
  res.status(201).json(player);
});

async function requireAdminForWrites(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  if (req.method === "GET") return next();
  if (!req.userId) return res.status(401).json({ error: "Not signed in." });
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } });
  if (!user || !["SUPERADMIN", "ADMIN"].includes(user.role)) {
    return res.status(403).json({ error: "Administrator access is required." });
  }
  req.userRole = user.role;

  const pathSegments = req.path.split("/").filter(Boolean);
  let tournamentId: string | undefined;
  if (req.baseUrl === "/api/tournaments") {
    if (req.method === "POST" && pathSegments.length === 0) return next();
    tournamentId = pathSegments[0];
  } else if (req.baseUrl === "/api/players") {
    tournamentId = req.body?.tournamentId || req.query.tournamentId as string | undefined;
    if (!tournamentId && pathSegments[0]) {
      const player = await prisma.player.findUnique({ where: { id: pathSegments[0] }, select: { tournamentId: true } });
      tournamentId = player?.tournamentId;
    }
  } else if (req.baseUrl === "/api/courts") {
    tournamentId = req.body?.tournamentId;
    if (!tournamentId && pathSegments[0]) {
      const court = await prisma.court.findUnique({ where: { id: pathSegments[0] }, select: { tournamentId: true } });
      tournamentId = court?.tournamentId;
    }
  } else if (req.baseUrl === "/api/games") {
    if (pathSegments[0]) {
      const game = await prisma.game.findUnique({ where: { id: pathSegments[0] }, select: { tournamentId: true } });
      tournamentId = game?.tournamentId;
    }
  } else if (req.baseUrl === "/api/queue") {
    tournamentId = pathSegments[0];
  } else if (req.baseUrl === "/api/brackets") {
    tournamentId = req.body?.tournamentId;
    if (!tournamentId && pathSegments[0] && pathSegments[0] !== "matches" && pathSegments[0] !== "entries") {
      const bracket = await prisma.bracket.findUnique({ where: { id: pathSegments[0] }, select: { tournamentId: true } });
      tournamentId = bracket?.tournamentId;
    }
    if (!tournamentId && pathSegments[0] === "matches" && pathSegments[1]) {
      const match = await prisma.bracketMatch.findUnique({ where: { id: pathSegments[1] }, include: { bracket: { select: { tournamentId: true } } } });
      tournamentId = match?.bracket.tournamentId;
    }
    if (!tournamentId && pathSegments[0] === "entries" && pathSegments[1]) {
      const entry = await prisma.bracketEntry.findUnique({ where: { id: pathSegments[1] }, include: { bracket: { select: { tournamentId: true } } } });
      tournamentId = entry?.bracket.tournamentId;
    }
  }

  if (!tournamentId || !(await canManageTournament(req, tournamentId))) {
    return res.status(403).json({ error: "You can only manage tournaments you own." });
  }
  next();
}

const tournamentAccess = [attachUser, requireAuth, requireAdminForWrites];
app.use("/api/tournaments", ...tournamentAccess, tournamentsRouter);
app.use("/api/players", ...tournamentAccess, playersRouter);
app.use("/api/courts", ...tournamentAccess, courtsRouter);
app.use("/api/games", ...tournamentAccess, gamesRouter);
app.use("/api/queue", ...tournamentAccess, queueRouter);
app.use("/api/leaderboard", ...tournamentAccess, leaderboardRouter);
app.use("/api/brackets", ...tournamentAccess, bracketRouter);

const frontendDist = path.resolve(__dirname, "../../frontend/dist");
app.use(express.static(frontendDist));
app.get("*", (_req, res, next) => {
  if (_req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(frontendDist, "index.html"), (error) => {
    if (error) next(error);
  });
});

const httpServer = createServer(app);
initSocket(httpServer);

// Finalize tournaments shortly after their scheduled end. Live countdowns are
// calculated by the board endpoint and updated in each browser, so this loop
// does not perform a database write every second or trigger full page reloads.
setInterval(async () => {
  // Auto-finalize: once a tournament's scheduled end time (e.g. 9:00 PM)
  // has passed and the operator hasn't extended it, record the current
  // standings as official and mark the tournament COMPLETED. Games already
  // in progress are left alone - staff can still finish them, and the
  // operator can hit "Extend" at any time to reopen and push the cutoff
  // forward for players who want to keep going.
  const now = new Date();
  const dueTournaments = await prisma.tournament.findMany({
    where: { status: "ACTIVE", scheduledEnd: { lte: now }, resultsFinalizedAt: null },
  });
  for (const t of dueTournaments) {
    const standings = await computeLeaderboard(t.id);
    await prisma.tournament.update({
      where: { id: t.id },
      data: { status: "COMPLETED", resultsFinalizedAt: now, finalStandings: standings as any },
    });
    broadcastTournamentUpdate(t.id, "tournament:changed");
  }
}, 5000);

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
httpServer.listen(PORT, () => {
  console.log(`Pickleball backend listening on :${PORT}`);
});
