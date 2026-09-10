import { Router } from "express";
import { prisma } from "../lib/prisma";
import { broadcastTournamentUpdate } from "../socket";
import { enqueuePlayer, refillUpcomingQueue, assignAllFreeCourts } from "../lib/queue";
import { recordBracketResult } from "../lib/bracket";
import { recordAudit } from "../lib/audit";
import { AuthedRequest } from "../lib/auth";

export const gamesRouter = Router();

const gameInclude = {
  players: { include: { player: true } },
  court: true,
};

function withCurrentRemainingSeconds<T extends { status: string; startedAt: Date | null; durationSeconds: number; remainingSeconds: number }>(game: T) {
  if (game.status !== "IN_PROGRESS" || !game.startedAt) return game;
  return {
    ...game,
    remainingSeconds: Math.max(0, game.durationSeconds - Math.floor((Date.now() - game.startedAt.getTime()) / 1000)),
  };
}

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

  res.json({
    nowPlaying: nowPlaying.map(withCurrentRemainingSeconds),
    upNext: upNext.map(withCurrentRemainingSeconds),
    waitingCount,
  });
});

// Staff sets/edits the timer length for a game (default 10 min, editable before or during)
gamesRouter.patch("/:id/duration", async (req, res) => {
  const { durationSeconds } = req.body;
  if (!Number.isInteger(durationSeconds) || durationSeconds < 60 || durationSeconds > 24 * 60 * 60) {
    return res.status(400).json({ error: "durationSeconds must be an integer between 60 and 86400." });
  }
  const current = await prisma.game.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Game not found." });
  if (!["UPCOMING", "READY", "IN_PROGRESS", "PAUSED"].includes(current.status)) {
    return res.status(400).json({ error: "Finished or cancelled games cannot be timed." });
  }
  const game = await prisma.game.update({
    where: { id: current.id },
    data: { durationSeconds, remainingSeconds: durationSeconds },
  });
  broadcastTournamentUpdate(game.tournamentId, "games:changed");
  res.json(game);
});

gamesRouter.patch("/:id/court", async (req, res) => {
  const { courtId } = req.body as { courtId?: string | null };
  const current = await prisma.game.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Game not found." });
  if (!["UPCOMING", "READY"].includes(current.status)) {
    return res.status(400).json({ error: "Only upcoming or ready games can be assigned to a court." });
  }
  if (courtId) {
    const court = await prisma.court.findFirst({ where: { id: courtId, tournamentId: current.tournamentId, isEnabled: true } });
    if (!court) return res.status(400).json({ error: "Court is not available for this tournament." });
    const occupied = await prisma.game.findFirst({
      where: { courtId, id: { not: current.id }, status: { in: ["READY", "IN_PROGRESS", "PAUSED"] } },
    });
    if (occupied) return res.status(409).json({ error: "That court already has an active game." });
  }
  const game = await prisma.game.update({
    where: { id: current.id },
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
  const current = await prisma.game.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Game not found." });
  if (current.status !== "READY" || !current.courtId) {
    return res.status(400).json({ error: "Only a ready game assigned to a court can be started." });
  }
  const claimed = await prisma.game.updateMany({
    where: { id: current.id, status: "READY", courtId: { not: null } },
    data: { status: "IN_PROGRESS", startedAt: new Date(), pausedAt: null },
  });
  if (claimed.count !== 1) return res.status(409).json({ error: "Game state changed; refresh and try again." });
  const game = await prisma.game.findUniqueOrThrow({ where: { id: current.id }, include: gameInclude });
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

  if (!winningTeam || typeof scoreA !== "number" || typeof scoreB !== "number" || !Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0 || scoreA > 99 || scoreB > 99 || scoreA === scoreB) {
    return res.status(400).json({ error: "A winning team and final, non-tied scores from 0 to 99 are required." });
  }
  if ((winningTeam === "A" && scoreA < scoreB) || (winningTeam === "B" && scoreB < scoreA)) {
    return res.status(400).json({ error: "The winning team must have the higher score." });
  }

  let game;
  try {
    game = await prisma.$transaction(async (tx) => {
      const current = await tx.game.findUnique({ where: { id: req.params.id }, include: gameInclude });
      if (!current || !["READY", "IN_PROGRESS", "PAUSED"].includes(current.status)) {
        throw new Error("Only a ready, in-progress, or paused game can be finished.");
      }

      const claimed = await tx.game.updateMany({
        where: { id: req.params.id, status: current.status },
        data: { status: "FINISHED", finishedAt: new Date(), winningTeam, scoreA, scoreB },
      });
      if (claimed.count !== 1) throw new Error("Game state changed; refresh and try again.");
      const finished = await tx.game.findUniqueOrThrow({ where: { id: req.params.id }, include: gameInclude });

      if (!finished.bracketMatchId) {
        for (const gp of finished.players) {
          await enqueuePlayer(finished.tournamentId, gp.playerId, tx);
        }
      }
      await recordAudit(tx, {
        tournamentId: finished.tournamentId,
        actorId: (req as AuthedRequest).userId,
        action: "GAME_FINISHED",
        entityType: "Game",
        entityId: finished.id,
        details: { winningTeam, scoreA, scoreB },
      });

      // Fixed-bracket: advance the winner (and, for double elimination, drop
      // the loser into the losers bracket) in the same transaction.
      if (finished.bracketMatchId && winningTeam) {
        const match = await tx.bracketMatch.findUnique({ where: { id: finished.bracketMatchId } });
        if (match) {
          const winnerEntryId = winningTeam === "A" ? match.entryAId : match.entryBId;
          const loserEntryId = winningTeam === "A" ? match.entryBId : match.entryAId;
          if (winnerEntryId) {
            await recordBracketResult(match.id, winnerEntryId, loserEntryId ?? null, tx);
          }
        }
      }

      return finished;
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to finish the game." });
  }

  // Keep the random-pairing pipeline flowing. Bracket games advance through
  // bracket state and must never be placed into the random queue.
  if (!game.bracketMatchId) {
    await refillUpcomingQueue(game.tournamentId);
    await assignAllFreeCourts(game.tournamentId);
  }
  await recordAudit(prisma, {
    tournamentId: game.tournamentId,
    actorId: (req as AuthedRequest).userId,
    action: "GAME_CANCELLED",
    entityType: "Game",
    entityId: game.id,
  });

  broadcastTournamentUpdate(game.tournamentId, "games:changed");
  res.json(game);
});

gamesRouter.post("/:id/cancel", async (req, res) => {
  const current = await prisma.game.findUnique({ where: { id: req.params.id }, include: gameInclude });
  if (!current) return res.status(404).json({ error: "Game not found." });
  if (!["UPCOMING", "READY", "IN_PROGRESS", "PAUSED"].includes(current.status)) {
    return res.status(400).json({ error: "Only queued or active games can be cancelled." });
  }
  const game = await prisma.game.update({
    where: { id: current.id },
    data: { status: "CANCELLED" },
    include: gameInclude,
  });
  if (!game.bracketMatchId) {
    for (const gp of game.players) {
      await enqueuePlayer(game.tournamentId, gp.playerId);
    }
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
  await recordAudit(prisma, {
    tournamentId: game.tournamentId,
    actorId: (req as AuthedRequest).userId,
    action: "PLAYER_SUBSTITUTED",
    entityType: "Game",
    entityId: game.id,
    details: { outPlayerId, inPlayerId },
  });

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
