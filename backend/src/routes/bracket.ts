import { Router } from "express";
import { prisma } from "../lib/prisma";
import { shuffle } from "../lib/matchmaking";
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

// Generate the selected format from every approved, non-withdrawn player.
bracketRouter.post("/:bracketId/auto-generate", async (req, res) => {
  const { format } = req.body as { format?: BracketFormat };
  const bracket = await prisma.bracket.findUniqueOrThrow({ where: { id: req.params.bracketId } });
  const fmt = format ?? bracket.format;
  if (!["SINGLE_ELIMINATION", "DOUBLE_ELIMINATION", "ROUND_ROBIN"].includes(fmt)) {
    return res.status(400).json({ error: "Choose single elimination, double elimination, or round robin." });
  }
  const existingGames = await prisma.game.count({ where: { bracketMatch: { bracketId: bracket.id } } });
  if (existingGames > 0) {
    return res.status(409).json({ error: "This bracket already has games and cannot be regenerated without losing its game history." });
  }

  const players = await prisma.player.findMany({
    where: { tournamentId: bracket.tournamentId, status: { not: "LEFT" }, joinStatus: "APPROVED" },
    select: { id: true },
  });
  if (players.length < 2) {
    return res.status(400).json({ error: "Need at least 2 available players/teams to build a bracket." });
  }

  if (fmt === "ROUND_ROBIN") {
    await prisma.bracketMatch.deleteMany({ where: { bracketId: req.params.bracketId } });
  } else {
    await createBracketShell(req.params.bracketId, players.length, fmt);
  }
  await prisma.bracketEntry.deleteMany({ where: { bracketId: req.params.bracketId } });

  const entries = await Promise.all(
    shuffle(players).map((player, index) => prisma.bracketEntry.create({
      data: { bracketId: req.params.bracketId, playerAId: player.id, seed: index + 1 },
    }))
  );

  if (fmt === "ROUND_ROBIN") {
    const matches = await generateRoundRobin(req.params.bracketId, entries.map((entry) => entry.id));
    broadcastTournamentUpdate(bracket.tournamentId, "bracket:generated");
    return res.json({ participantCount: players.length, matches });
  }

  const round1 = await prisma.bracketMatch.findMany({
    where: { bracketId: req.params.bracketId, bracketSide: "WINNERS", round: 1 },
    orderBy: { slot: "asc" },
  });
  const byeCount = round1.length * 2 - entries.length;
  let entryIndex = 0;
  for (let index = 0; index < round1.length; index++) {
    const entryA = entries[entryIndex++];
    const entryB = index < byeCount ? null : entries[entryIndex++];
    await prisma.bracketMatch.update({
      where: { id: round1[index].id },
      data: { entryAId: entryA?.id ?? null, entryBId: entryB?.id ?? null },
    });
  }

  const matches = await lockByes(req.params.bracketId);
  broadcastTournamentUpdate(bracket.tournamentId, "bracket:generated");
  res.json({ participantCount: players.length, matches });
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
  const { courtId, durationSeconds } = req.body as { courtId?: string; durationSeconds?: number };
  if (!courtId) return res.status(400).json({ error: "Choose a court for this match." });
  if (durationSeconds !== undefined && (!Number.isInteger(durationSeconds) || durationSeconds < 60 || durationSeconds > 86400)) {
    return res.status(400).json({ error: "durationSeconds must be an integer between 60 and 86400." });
  }
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

  const gameState = await prisma.$transaction(async (tx) => {
    const court = await tx.court.findFirst({ where: { id: courtId, tournamentId: bracket.tournamentId, isEnabled: true } });
    if (!court) return { error: "Court is not available for this tournament." as const };
    const occupied = await tx.game.findFirst({
      where: { courtId, status: { in: ["READY", "IN_PROGRESS", "PAUSED"] } },
      select: { id: true },
    });
    if (occupied) return { error: "That court already has an active game." as const };

    const existingGame = await tx.game.findUnique({ where: { bracketMatchId: match.id } });
    if (existingGame && existingGame.status !== "CANCELLED") {
      return { error: "This bracket match already has a game." as const };
    }

    const duration = durationSeconds ?? 900;
    if (existingGame) {
      const claimed = await tx.game.updateMany({
        where: { id: existingGame.id, status: "CANCELLED" },
        data: {
          courtId,
          status: "READY",
          durationSeconds: duration,
          remainingSeconds: duration,
          startedAt: null,
          pausedAt: null,
          finishedAt: null,
          winningTeam: null,
          scoreA: null,
          scoreB: null,
        },
      });
      if (claimed.count !== 1) return { error: "This cancelled game was already restarted." as const };
      await tx.gamePlayer.deleteMany({ where: { gameId: existingGame.id } });
      await tx.gamePlayer.createMany({ data: playersData.map((player) => ({ ...player, gameId: existingGame.id })) });
      return { game: await tx.game.findUniqueOrThrow({ where: { id: existingGame.id }, include: { players: { include: { player: true } }, court: true } }) };
    }

    return {
      game: await tx.game.create({
        data: {
          tournamentId: bracket.tournamentId,
          courtId,
          status: "READY",
          bracketMatchId: match.id,
          durationSeconds: duration,
          remainingSeconds: duration,
          players: { create: playersData },
        },
        include: { players: { include: { player: true } }, court: true },
      }),
    };
  });
  if ("error" in gameState) return res.status(409).json({ error: gameState.error });

  broadcastTournamentUpdate(bracket.tournamentId, "games:changed");
  res.status(201).json(gameState.game);
});
