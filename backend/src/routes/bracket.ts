import { Router } from "express";
import { prisma } from "../lib/prisma";
import {
  createBracketShell,
  generateFromExistingEntries,
  fillBracketSlot,
  clearBracketSlot,
  lockByes,
  resolveOrCreatePlayerByName,
  substituteBracketPlayer,
  generateRoundRobin,
  roundRobinStandings,
  BracketFormat,
} from "../lib/bracket";
import { broadcastTournamentUpdate } from "../socket";

export const bracketRouter = Router();

// Create a bracket container for a FIXED_BRACKET tournament. `format`
// defaults to single elimination but can be set here or changed later via
// /auto-generate.
bracketRouter.post("/", async (req, res) => {
  const { tournamentId, name, format } = req.body as { tournamentId: string; name?: string; format?: BracketFormat };
  const bracket = await prisma.bracket.create({
    data: { tournamentId, name, format: format ?? "SINGLE_ELIMINATION" },
  });
  res.status(201).json(bracket);
});

bracketRouter.get("/for-tournament/:tournamentId", async (req, res) => {
  const bracket = await prisma.bracket.findFirst({ where: { tournamentId: req.params.tournamentId } });
  res.json(bracket);
});

// Register a fixed pair (team) into the bracket ahead of time, e.g. two
// players who signed up together. Optional - most brackets are built by
// filling empty slots directly (see /auto-generate + /matches/:id/slot).
bracketRouter.post("/:bracketId/entries", async (req, res) => {
  const { playerAId, playerBId, teamName, seed } = req.body;
  const entry = await prisma.bracketEntry.create({
    data: { bracketId: req.params.bracketId, playerAId, playerBId, teamName, seed },
  });
  res.status(201).json(entry);
});

// Legacy/alternate flow: build the bracket from BracketEntry rows that were
// already registered via the endpoint above.
bracketRouter.post("/:bracketId/generate", async (req, res) => {
  const matches = await generateFromExistingEntries(req.params.bracketId);
  const bracket = await prisma.bracket.findUniqueOrThrow({ where: { id: req.params.bracketId } });
  broadcastTournamentUpdate(bracket.tournamentId, "bracket:generated");
  res.json(matches);
});

// Auto-bracket: given how many players/teams are available (or the current
// tournament roster count if omitted), build the right-sized empty bracket
// shell - byes computed automatically - ready for slots to be filled by
// drag-drop or typed name. Not used for ROUND_ROBIN (see /round-robin).
bracketRouter.post("/:bracketId/auto-generate", async (req, res) => {
  const { participantCount, format } = req.body as { participantCount?: number; format?: BracketFormat };
  const bracket = await prisma.bracket.findUniqueOrThrow({ where: { id: req.params.bracketId } });
  const fmt = format ?? bracket.format;

  if (fmt === "ROUND_ROBIN") {
    return res
      .status(400)
      .json({ error: "Round Robin doesn't use an empty bracket shell - add participants and POST /round-robin instead." });
  }

  let count = participantCount;
  if (!count) {
    count = await prisma.player.count({
      where: { tournamentId: bracket.tournamentId, status: { not: "LEFT" }, joinStatus: "APPROVED" },
    });
  }
  if (!count || count < 2) {
    return res.status(400).json({ error: "Need at least 2 available players/teams to build a bracket." });
  }

  const matches = await createBracketShell(req.params.bracketId, count, fmt);
  broadcastTournamentUpdate(bracket.tournamentId, "bracket:generated");
  res.json(matches);
});

// Round Robin: pass the player ids in the pool, and the full round-by-round
// schedule is generated immediately (every pairing is known up front).
bracketRouter.post("/:bracketId/round-robin", async (req, res) => {
  const { playerIds } = req.body as { playerIds: string[] };
  if (!playerIds || playerIds.length < 2) {
    return res.status(400).json({ error: "Need at least 2 players/teams for a round robin." });
  }
  await prisma.bracketEntry.deleteMany({ where: { bracketId: req.params.bracketId } });
  const entries = await Promise.all(
    playerIds.map((playerId) => prisma.bracketEntry.create({ data: { bracketId: req.params.bracketId, playerAId: playerId } }))
  );
  const matches = await generateRoundRobin(
    req.params.bracketId,
    entries.map((e) => e.id)
  );
  const bracket = await prisma.bracket.findUniqueOrThrow({ where: { id: req.params.bracketId } });
  broadcastTournamentUpdate(bracket.tournamentId, "bracket:generated");
  res.json(matches);
});

bracketRouter.get("/:bracketId", async (req, res) => {
  const matches = await prisma.bracketMatch.findMany({
    where: { bracketId: req.params.bracketId },
    orderBy: [{ bracketSide: "asc" }, { round: "asc" }, { slot: "asc" }],
    include: { game: true },
  });
  res.json(matches);
});

bracketRouter.get("/:bracketId/entries", async (req, res) => {
  const entries = await prisma.bracketEntry.findMany({ where: { bracketId: req.params.bracketId } });
  res.json(entries);
});

bracketRouter.get("/:bracketId/standings", async (req, res) => {
  const bracket = await prisma.bracket.findUniqueOrThrow({ where: { id: req.params.bracketId } });
  if (bracket.format !== "ROUND_ROBIN") return res.json([]);
  const rows = await roundRobinStandings(req.params.bracketId);
  res.json(rows);
});

// Fill one slot of an empty bracket match - the "drag a name in / type a
// name" endpoint. Accepts either an existing player id (drag from roster)
// or a free-typed name (looked up, or created if new).
bracketRouter.patch("/matches/:matchId/slot", async (req, res) => {
  const { slot, playerId, name } = req.body as { slot: "A" | "B"; playerId?: string; name?: string };
  if (slot !== "A" && slot !== "B") return res.status(400).json({ error: "slot must be 'A' or 'B'" });

  const match = await prisma.bracketMatch.findUniqueOrThrow({ where: { id: req.params.matchId } });
  const bracket = await prisma.bracket.findUniqueOrThrow({ where: { id: match.bracketId } });

  let resolvedPlayerId = playerId;
  if (!resolvedPlayerId) {
    if (!name || !name.trim()) return res.status(400).json({ error: "playerId or name is required" });
    const player = await resolveOrCreatePlayerByName(bracket.tournamentId, name);
    resolvedPlayerId = player.id;
  }
  if (!resolvedPlayerId) return res.status(400).json({ error: "playerId or name is required" });

  const entry = await fillBracketSlot(match.id, slot, resolvedPlayerId);
  broadcastTournamentUpdate(bracket.tournamentId, "bracket:generated");
  broadcastTournamentUpdate(bracket.tournamentId, "players:changed"); // covers newly-created players
  res.status(201).json(entry);
});

bracketRouter.delete("/matches/:matchId/slot", async (req, res) => {
  const { slot } = req.body as { slot: "A" | "B" };
  if (slot !== "A" && slot !== "B") return res.status(400).json({ error: "slot must be 'A' or 'B'" });
  const match = await clearBracketSlot(req.params.matchId, slot);
  const bracket = await prisma.bracket.findUniqueOrThrow({ where: { id: match.bracketId } });
  broadcastTournamentUpdate(bracket.tournamentId, "bracket:generated");
  res.json(match);
});

// After filling in the slots you want filled, lock in byes: any round-1
// match with only one side occupied auto-advances that entry.
bracketRouter.post("/:bracketId/lock-byes", async (req, res) => {
  const matches = await lockByes(req.params.bracketId);
  const bracket = await prisma.bracket.findUniqueOrThrow({ where: { id: req.params.bracketId } });
  broadcastTournamentUpdate(bracket.tournamentId, "bracket:generated");
  res.json(matches);
});

// Editable brackets: swap in a substitute player for an entry mid-tournament
// (also how a doubles partner gets attached after a slot was filled with
// just one player).
bracketRouter.patch("/entries/:entryId/substitute", async (req, res) => {
  const { slot, newPlayerId } = req.body as { slot: "A" | "B"; newPlayerId: string };
  const entry = await substituteBracketPlayer(req.params.entryId, slot, newPlayerId);
  res.json(entry);
});

// Assign a court + create the playable Game for a specific bracket match
bracketRouter.post("/matches/:matchId/start-game", async (req, res) => {
  const { courtId, durationSeconds } = req.body;
  const match = await prisma.bracketMatch.findUniqueOrThrow({ where: { id: req.params.matchId } });
  if (!match.entryAId || !match.entryBId) {
    return res.status(400).json({ error: "Both entries must be set before starting this match" });
  }
  const bracket = await prisma.bracket.findUniqueOrThrow({ where: { id: match.bracketId } });
  const entryA = await prisma.bracketEntry.findUniqueOrThrow({ where: { id: match.entryAId } });
  const entryB = await prisma.bracketEntry.findUniqueOrThrow({ where: { id: match.entryBId } });

  const playersData = [
    { playerId: entryA.playerAId, team: "A" as const },
    ...(entryA.playerBId ? [{ playerId: entryA.playerBId, team: "A" as const }] : []),
    { playerId: entryB.playerAId, team: "B" as const },
    ...(entryB.playerBId ? [{ playerId: entryB.playerBId, team: "B" as const }] : []),
  ];

  const game = await prisma.game.create({
    data: {
      tournamentId: bracket.tournamentId,
      courtId,
      status: "READY",
      bracketMatchId: match.id,
      durationSeconds: durationSeconds ?? 600,
      remainingSeconds: durationSeconds ?? 600,
      players: { create: playersData },
    },
  });

  broadcastTournamentUpdate(bracket.tournamentId, "games:changed");
  res.status(201).json(game);
});
