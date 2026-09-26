import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import path from "path";
import { prisma } from "./lib/prisma";
import { initSocket, broadcastTournamentUpdate } from "./socket";
import { computeLeaderboard, countUnfinishedGames } from "./lib/leaderboard";

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
import { postsRouter } from "./routes/posts";
import { usersRouter } from "./routes/users";
import { notificationsRouter } from "./routes/notifications";
import { attachUser, requireAuth, canManageTournament, AuthedRequest } from "./lib/auth";

const app = express();
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    if (req.path !== "/health") console.log(JSON.stringify({ method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - startedAt }));
  });
  next();
});
app.use(cors({
  origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/health/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, database: "ready" });
  } catch {
    res.status(503).json({ ok: false, database: "unavailable" });
  }
});

app.use("/api/auth", authRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/billing", billingRouter);
app.use("/api/raffles", rafflesRouter);
app.use("/api/posts", postsRouter);
app.use("/api/users", usersRouter);
app.use("/api/notifications", notificationsRouter);

app.post("/api/players/join", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  if (!req.userId) return res.status(401).json({ error: "Not signed in." });
  const { tournamentId, name, skillLevel, contact } = req.body;
  if (!tournamentId || typeof name !== "string" || name.trim().length < 2 || name.trim().length > 80 || !["BEGINNER", "AVERAGE", "ADVANCE"].includes(skillLevel)) {
    return res.status(400).json({ error: "Your display name and a valid skill level are required" });
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { username: true, role: true } });
  if (!user || user.role !== "PLAYER") return res.status(403).json({ error: "Only player accounts can join tournaments." });
  const publishedPost = await prisma.tournamentPost.findFirst({ where: { tournamentId, hostId: { not: req.userId } }, select: { id: true } });
  if (publishedPost) return res.status(409).json({ error: "This tournament requires payment proof approval. Open its platform post to request entry." });
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
    if (req.method === "DELETE" && pathSegments.length === 0) return next();
    if (req.method === "DELETE" && pathSegments[0] === "previous") return next();
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

// Tournament reads are public for spectators. Mutations still require an
// authenticated administrator and are checked against tournament ownership.
const tournamentAccess = [attachUser, requireAdminForWrites];
app.use("/api/tournaments", ...tournamentAccess, tournamentsRouter);
app.use("/api/players", ...tournamentAccess, playersRouter);
app.use("/api/courts", ...tournamentAccess, courtsRouter);
app.use("/api/games", ...tournamentAccess, gamesRouter);
app.use("/api/queue", ...tournamentAccess, queueRouter);
app.use("/api/leaderboard", ...tournamentAccess, leaderboardRouter);
app.use("/api/brackets", ...tournamentAccess, bracketRouter);

const frontendDist = path.resolve(__dirname, "../../frontend/dist");
app.use(express.static(frontendDist));
app.use("/uploads/avatars", express.static(path.resolve(__dirname, "../uploads/avatars")));
app.use("/uploads/tournaments", express.static(path.resolve(__dirname, "../uploads/tournaments")));
app.get("*", (_req, res, next) => {
  if (_req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(frontendDist, "index.html"), (error) => {
    if (error) next(error);
  });
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled request error", error);
  res.status(500).json({ error: "Internal server error." });
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
    where: {
      status: "ACTIVE",
      scheduledEnd: { lte: now },
      resultsFinalizedAt: null,
      games: { none: { status: { in: ["UPCOMING", "READY", "IN_PROGRESS", "PAUSED"] } } },
    },
  });
  for (const t of dueTournaments) {
    if (await countUnfinishedGames(t.id) > 0) continue;
    const standings = await computeLeaderboard(t.id);
    const finalized = await prisma.tournament.updateMany({
      where: { id: t.id, status: "ACTIVE", resultsFinalizedAt: null },
      data: { status: "COMPLETED", resultsFinalizedAt: now, finalStandings: standings as any },
    });
    if (finalized.count === 1) broadcastTournamentUpdate(t.id, "tournament:changed");
  }
}, 5000);

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
httpServer.listen(PORT, () => {
  console.log(`Pickleball backend listening on :${PORT}`);
});
