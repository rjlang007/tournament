import { Router } from "express";
import { prisma } from "../lib/prisma";
import { broadcastTournamentUpdate } from "../socket";
import { enqueuePlayer, refillUpcomingQueue, assignAllFreeCourts } from "../lib/queue";
import { recordBracketResult } from "../lib/bracket";

export const gamesRouter = Router();

const gameInclude = {
  players: { include: { player: true } },
  court: true,
};

// Kiosk feed: now playing (per court) + next 4-6 upcoming + waiting pool count
gamesRouter.get("/board/:tournamentId", async (req, res) => {
  const tournamentId = req.params.tournamentId;

  const nowPlaying = await prisma.game.findMany({
    where: { tournamentId, status: { in: ["IN_PROGRESS", "PAUSED", "READY"] } },
    include: gameInclude,
    orderBy: { court: { label: "asc" } },
  });

  const upNext = await prisma.game.findMany({
    where: { tournamentId, status: "UPCOMING" },
    include: gameInclude,
    orderBy: { createdAt: "asc" },
    take: 6,
  });

  const waitingCount = await prisma.queueEntry.count({ where: { tournamentId } });

  res.json({ nowPlaying, upNext, waitingCount });
});

// Staff sets/edits the timer length for a game (default 10 min, editable before or during)
gamesRouter.patch("/:id/duration", async (req, res) => {
  const { durationSeconds } = req.body;
  const game = await prisma.game.update({
    where: { id: req.params.id },
    data: { durationSeconds, remainingSeconds: durationSeconds },
  });
  broadcastTournamentUpdate(game.tournamentId, "games:changed");
  res.json(game);
});

gamesRouter.patch("/:id/court", async (req, res) => {
  const { courtId } = req.body as { courtId?: string | null };
  const game = await prisma.game.update({
    where: { id: req.params.id },
    data: {
      courtId: courtId || null,
      status: courtId ? "READY" : "UPCOMING",
    },
    include: gameInclude,
  });
  broadcastTournamentUpdate(game.tournamentId, "games:changed");
  res.json(game);
});

gamesRouter.post("/:id/start", async (req, res) => {
  const game = await prisma.game.update({
    where: { id: req.params.id },
    data: { status: "IN_PROGRESS", startedAt: new Date(), pausedAt: null },
  });
  broadcastTournamentUpdate(game.tournamentId, "games:changed");
  res.json(game);
});

gamesRouter.post("/:id/pause", async (req, res) => {
  const current = await prisma.game.findUnique({ where: { id: req.params.id } });
  if (!current || current.status !== "IN_PROGRESS" || !current.startedAt) {
    return res.status(400).json({ error: "Only an in-progress game can be paused." });
  }
  const elapsedSeconds = Math.floor((Date.now() - current.startedAt.getTime()) / 1000);
  const remainingSeconds = Math.max(0, current.durationSeconds - elapsedSeconds);
  const game = await prisma.game.update({
    where: { id: req.params.id },
    data: { status: "PAUSED", pausedAt: new Date(), remainingSeconds },
  });
  broadcastTournamentUpdate(game.tournamentId, "games:changed");
  res.json(game);
});

gamesRouter.post("/:id/resume", async (req, res) => {
  const current = await prisma.game.findUnique({ where: { id: req.params.id } });
  if (!current || current.status !== "PAUSED") {
    return res.status(400).json({ error: "Only a paused game can be resumed." });
  }
  const elapsedBeforePause = Math.max(0, current.durationSeconds - current.remainingSeconds);
  const game = await prisma.game.update({
    where: { id: req.params.id },
    data: { status: "IN_PROGRESS", pausedAt: null, startedAt: new Date(Date.now() - elapsedBeforePause * 1000) },
  });
  broadcastTournamentUpdate(game.tournamentId, "games:changed");
  res.json(game);
});

// Staff marks the game finished, optionally records the score and winning team.
// This is what feeds the leaderboard (wins/losses) for random-pairing tournaments,
// and what advances the bracket for fixed tournaments.
gamesRouter.post("/:id/finish", async (req, res) => {
  const { winningTeam, scoreA, scoreB } = req.body as {
    winningTeam?: "A" | "B";
    scoreA?: number;
    scoreB?: number;
  };

  const game = await prisma.game.update({
    where: { id: req.params.id },
    data: { status: "FINISHED", finishedAt: new Date(), winningTeam, scoreA, scoreB },
    include: gameInclude,
  });

  // Free the court and return its players to WAITING so they can be re-queued.
  if (game.courtId) {
    await prisma.court.update({ where: { id: game.courtId }, data: {} }); // no-op, court stays; game just leaves READY/IN_PROGRESS pool
  }
  for (const gp of game.players) {
    await enqueuePlayer(game.tournamentId, gp.playerId);
  }

  // Fixed-bracket: advance the winner (and, for double elimination, drop
  // the loser into the losers bracket).
  if (game.bracketMatchId && winningTeam) {
    const match = await prisma.bracketMatch.findUnique({ where: { id: game.bracketMatchId } });
    if (match) {
      const winnerEntryId = winningTeam === "A" ? match.entryAId : match.entryBId;
      const loserEntryId = winningTeam === "A" ? match.entryBId : match.entryAId;
      if (winnerEntryId) {
        await recordBracketResult(match.id, winnerEntryId, loserEntryId ?? null);
      }
    }
  }

  // Keep the pipeline flowing: refill the upcoming preview and fill any free court.
  await refillUpcomingQueue(game.tournamentId);
  await assignAllFreeCourts(game.tournamentId);

  broadcastTournamentUpdate(game.tournamentId, "games:changed");
  res.json(game);
});

gamesRouter.post("/:id/cancel", async (req, res) => {
  const game = await prisma.game.update({
    where: { id: req.params.id },
    data: { status: "CANCELLED" },
    include: gameInclude,
  });
  for (const gp of game.players) {
    await enqueuePlayer(game.tournamentId, gp.playerId);
  }
  broadcastTournamentUpdate(game.tournamentId, "games:changed");
  res.json(game);
});

// Edit a game's roster - substitution when a player leaves mid-tournament.
gamesRouter.patch("/:id/substitute", async (req, res) => {
  const { outPlayerId, inPlayerId } = req.body;
  const game = await prisma.game.findUnique({ where: { id: req.params.id } });
  if (!game || !["UPCOMING", "READY", "IN_PROGRESS", "PAUSED"].includes(game.status)) {
    return res.status(400).json({ error: "Players can only be replaced before a game is finished." });
  }
  const gamePlayer = await prisma.gamePlayer.findFirst({
    where: { gameId: req.params.id, playerId: outPlayerId },
  });
  if (!gamePlayer) return res.status(404).json({ error: "player not in this game" });
  const outgoing = await prisma.player.findUnique({ where: { id: outPlayerId }, select: { skillLevel: true } });
  const replacement = await prisma.player.findFirst({
    where: { id: inPlayerId, tournamentId: game.tournamentId, joinStatus: "APPROVED", skillLevel: outgoing?.skillLevel, status: { in: ["WAITING", "LEFT"] }, gamePlayers: { none: { game: { status: { in: ["READY", "IN_PROGRESS", "PAUSED"] } } } } },
  });
  if (!replacement) return res.status(400).json({ error: "Replacement must be an approved player who is not active in another game." });

  const updated = await prisma.gamePlayer.update({
    where: { id: gamePlayer.id },
    data: { playerId: inPlayerId },
  });
  await prisma.player.update({ where: { id: outPlayerId }, data: { status: "LEFT" } });
  await prisma.player.update({ where: { id: inPlayerId }, data: { status: game.status === "IN_PROGRESS" || game.status === "PAUSED" ? "PLAYING" : "QUEUED" } });

  broadcastTournamentUpdate(game.tournamentId, "games:changed");
  res.json(updated);
});

gamesRouter.delete("/:id/player/:playerId", async (req, res) => {
  const game = await prisma.game.findUnique({ where: { id: req.params.id } });
  if (!game || !["UPCOMING", "READY", "IN_PROGRESS", "PAUSED"].includes(game.status)) {
    return res.status(400).json({ error: "Players can only be removed before a game is finished." });
  }
  const gamePlayer = await prisma.gamePlayer.findFirst({ where: { gameId: game.id, playerId: req.params.playerId } });
  if (!gamePlayer) return res.status(404).json({ error: "Player not in this game." });
  await prisma.gamePlayer.delete({ where: { id: gamePlayer.id } });
  await prisma.player.update({ where: { id: req.params.playerId }, data: { status: "LEFT" } });
  broadcastTournamentUpdate(game.tournamentId, "games:changed");
  res.json({ ok: true });
});
