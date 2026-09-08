import { Router } from "express";
import { prisma } from "../lib/prisma";
import { refillUpcomingQueue, assignAllFreeCourts } from "../lib/queue";
import { broadcastTournamentUpdate } from "../socket";

export const queueRouter = Router();

// Current waiting pool (for the admin/staff screen)
queueRouter.get("/:tournamentId", async (req, res) => {
  const entries = await prisma.queueEntry.findMany({
    where: { tournamentId: req.params.tournamentId },
    include: { player: true },
    orderBy: { enqueuedAt: "asc" },
  });
  res.json(entries);
});

queueRouter.patch("/:tournamentId/reorder", async (req, res) => {
  const tournamentId = req.params.tournamentId;
  const playerIds = Array.isArray(req.body?.playerIds) ? req.body.playerIds as string[] : [];

  if (playerIds.length === 0) {
    return res.status(400).json({ error: "Provide an ordered list of player IDs." });
  }

  const queueEntries = await prisma.queueEntry.findMany({
    where: { tournamentId },
    include: { player: true },
    orderBy: { enqueuedAt: "asc" },
  });

  const queueMap = new Map(queueEntries.map((entry) => [entry.playerId, entry]));
  const orderedIds = playerIds.filter((playerId) => queueMap.has(playerId));

  if (orderedIds.length !== queueEntries.length) {
    return res.status(400).json({ error: "Queue order must include every waiting player." });
  }

  const now = Date.now();
  await prisma.$transaction(
    orderedIds.map((playerId, index) =>
      prisma.queueEntry.update({
        where: { tournamentId_playerId: { tournamentId, playerId } },
        data: { enqueuedAt: new Date(now + index * 1000) },
      })
    )
  );

  const updated = await prisma.queueEntry.findMany({
    where: { tournamentId },
    include: { player: true },
    orderBy: { enqueuedAt: "asc" },
  });

  broadcastTournamentUpdate(tournamentId, "queue:reordered", { playerIds: orderedIds });
  broadcastTournamentUpdate(tournamentId, "games:changed");
  res.json(updated);
});

queueRouter.delete("/:tournamentId/player/:playerId", async (req, res) => {
  const { tournamentId, playerId } = req.params;
  await prisma.queueEntry.deleteMany({ where: { tournamentId, playerId } });
  await prisma.player.updateMany({ where: { id: playerId, tournamentId }, data: { status: "LEFT" } });
  broadcastTournamentUpdate(tournamentId, "queue:changed");
  broadcastTournamentUpdate(tournamentId, "players:changed");
  res.json({ ok: true });
});

queueRouter.delete("/:tournamentId", async (req, res) => {
  const { tournamentId } = req.params;
  const entries = await prisma.queueEntry.findMany({ where: { tournamentId }, select: { playerId: true } });
  await prisma.$transaction([
    prisma.queueEntry.deleteMany({ where: { tournamentId } }),
    prisma.player.updateMany({ where: { tournamentId, id: { in: entries.map((entry) => entry.playerId) } }, data: { status: "LEFT" } }),
  ]);
  broadcastTournamentUpdate(tournamentId, "queue:changed");
  broadcastTournamentUpdate(tournamentId, "players:changed");
  broadcastTournamentUpdate(tournamentId, "games:changed");
  res.json({ removed: entries.length });
});

queueRouter.patch("/:tournamentId/replace", async (req, res) => {
  const { tournamentId } = req.params;
  const { playerId, replacementPlayerId } = req.body as { playerId?: string; replacementPlayerId?: string };
  if (!playerId || !replacementPlayerId || playerId === replacementPlayerId) {
    return res.status(400).json({ error: "A queued player and a different replacement are required." });
  }
  const currentPlayer = await prisma.player.findFirst({ where: { id: playerId, tournamentId }, select: { skillLevel: true } });
  const replacement = await prisma.player.findFirst({
    where: {
      id: replacementPlayerId,
      tournamentId,
      joinStatus: "APPROVED",
      skillLevel: currentPlayer?.skillLevel,
      status: { in: ["WAITING", "LEFT"] },
      queueEntries: { none: {} },
    },
  });
  if (!replacement) return res.status(400).json({ error: "Replacement must be an approved player who is not currently playing or queued." });
  const current = await prisma.queueEntry.findUnique({ where: { tournamentId_playerId: { tournamentId, playerId } } });
  if (!current) return res.status(404).json({ error: "Player is no longer waiting in the queue." });

  await prisma.$transaction([
    prisma.queueEntry.delete({ where: { tournamentId_playerId: { tournamentId, playerId } } }),
    prisma.player.update({ where: { id: playerId }, data: { status: "LEFT" } }),
    prisma.player.update({ where: { id: replacementPlayerId }, data: { status: "WAITING" } }),
    prisma.queueEntry.create({ data: { tournamentId, playerId: replacementPlayerId, enqueuedAt: current.enqueuedAt } }),
  ]);
  broadcastTournamentUpdate(tournamentId, "queue:changed");
  broadcastTournamentUpdate(tournamentId, "players:changed");
  res.json({ ok: true });
});

/**
 * "Spin the wheel" / bunot-bunot trigger.
 * Draws eligible skill-based pairings from the waiting pool and creates
 * UPCOMING games out of them, then tries to seat any free courts.
 * The frontend plays the wheel/reveal animation using the returned games
 * before showing them as confirmed on the kiosk.
 */
queueRouter.post("/:tournamentId/draw", async (req, res) => {
  const result = await refillUpcomingQueue(req.params.tournamentId);
  await assignAllFreeCourts(req.params.tournamentId);
  broadcastTournamentUpdate(req.params.tournamentId, "queue:drawn", result);
  broadcastTournamentUpdate(req.params.tournamentId, "games:changed");
  res.json(result);
});
