import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";
import { buildQueueBatch, QueuedPlayer } from "./matchmaking";

type DatabaseClient = typeof prisma | Prisma.TransactionClient;

const UPCOMING_PREVIEW_SIZE = 6; // "4-6 waiting games" shown on kiosk

/**
 * Refills the UPCOMING game preview for a RANDOM_PAIRING tournament.
 *
 * 1. Looks at players currently in the tournament's queue (status WAITING,
 *    enqueued, not already in a live/queued game).
 * 2. Draws as many valid doubles games as needed to reach the preview size,
 *    respecting the skill-pairing rule via buildQueueBatch/bunot-bunot draw.
 * 3. Creates Game rows with status UPCOMING (no court assigned yet).
 *
 * Leftover players who can't be matched (e.g. all remaining are Advance
 * with no Beginners left) stay in the queue untouched for the next refill.
 */
export async function refillUpcomingQueue(tournamentId: string, minPreview = 4, maxPreview?: number) {
  // Always draw enough games to seat every enabled court plus a small
  // preview buffer, so a draw never leaves courts empty just because the
  // default preview size (6) was smaller than the number of courts.
  const enabledCourts = await prisma.court.count({ where: { tournamentId, isEnabled: true } });
  const effectiveMaxPreview = maxPreview ?? Math.max(UPCOMING_PREVIEW_SIZE, enabledCourts + 2);

  const existingUpcoming = await prisma.game.count({
    where: { tournamentId, status: "UPCOMING" },
  });
  const slotsToFill = Math.max(0, effectiveMaxPreview - existingUpcoming);
  if (slotsToFill === 0) return { created: 0 };

  const queueEntries = await prisma.queueEntry.findMany({
    where: { tournamentId },
    include: {
      player: {
        include: {
          gamePlayers: {
            where: { game: { status: "FINISHED" } },
            select: { id: true },
          },
        },
      },
    },
    orderBy: { enqueuedAt: "asc" },
  });

  const pool: QueuedPlayer[] = queueEntries
    .filter((q) => q.player.status === "WAITING" && q.player.joinStatus === "APPROVED")
    .map((q) => ({
      id: q.player.id,
      name: q.player.name,
      skillLevel: q.player.skillLevel,
      gamesPlayed: q.player.gamePlayers.length,
      joinedAt: q.player.createdAt.getTime(),
    }));

  const { games } = buildQueueBatch(pool, slotsToFill);

  let created = 0;
  for (const g of games) {
    const nextGame = await prisma.game.create({
      data: {
        tournamentId,
        status: "UPCOMING",
        players: {
          create: [
            { playerId: g.teamA[0].id, team: "A" },
            { playerId: g.teamA[1].id, team: "A" },
            { playerId: g.teamB[0].id, team: "B" },
            { playerId: g.teamB[1].id, team: "B" },
          ],
        },
      },
    });

    const playerIds = [...g.teamA, ...g.teamB].map((p) => p.id);
    await prisma.player.updateMany({
      where: { id: { in: playerIds } },
      data: { status: "QUEUED" },
    });
    await prisma.queueEntry.deleteMany({ where: { playerId: { in: playerIds } } });
    created++;
    void nextGame;
  }

  return { created, remainingInQueue: pool.length - created * 4 };
}

/** Assigns the oldest UPCOMING game to a free, enabled court and marks it READY. */
export async function assignNextGameToFreeCourt(tournamentId: string) {
  const freeCourt = await prisma.court.findFirst({
    where: {
      tournamentId,
      isEnabled: true,
      games: { none: { status: { in: ["READY", "IN_PROGRESS", "PAUSED"] } } },
    },
  });
  if (!freeCourt) return null;

  const nextGame = await prisma.game.findFirst({
    where: { tournamentId, status: "UPCOMING" },
    orderBy: { createdAt: "asc" },
  });
  if (!nextGame) return null;

  return prisma.game.update({
    where: { id: nextGame.id },
    data: { courtId: freeCourt.id, status: "READY" },
  });
}

/**
 * Seats EVERY free, enabled court with the next available UPCOMING game -
 * not just one. Call this instead of assignNextGameToFreeCourt anywhere
 * multiple courts might be open at once (after a draw, after a game
 * finishes, after a court is re-enabled), so all courts get used.
 */
export async function assignAllFreeCourts(tournamentId: string) {
  const assignedGameIds: string[] = [];
  while (true) {
    const assigned = await assignNextGameToFreeCourt(tournamentId);
    if (!assigned) break;
    assignedGameIds.push(assigned.id);
  }
  return assignedGameIds;
}

/** Adds a player back into the waiting pool / queue (e.g. after finishing a game, or a walk-in registrant). */
export async function enqueuePlayer(tournamentId: string, playerId: string, db: DatabaseClient = prisma) {
  await db.player.update({ where: { id: playerId }, data: { status: "WAITING" } });
  return db.queueEntry.upsert({
    where: { tournamentId_playerId: { tournamentId, playerId } },
    update: {},
    create: { tournamentId, playerId },
  });
}
