import { prisma } from "./prisma";
import { shuffle } from "./matchmaking";

/**
 * Creates a special one-off game between exactly the players passed in,
 * to break a podium tie flagged by detectPodiumTies() during Finalize.
 *
 * This intentionally bypasses the normal skill-pairing rule (see
 * matchmaking.ts) - it's a fixed exhibition match between the specific
 * tied players, not routine matchmaking. The group is split as evenly as
 * possible into Team A / Team B (2v2 for a 4-way tie, 1v1 for a 2-way
 * tie, etc). Whoever wins it gets the extra recorded win, which naturally
 * breaks the tie once the leaderboard recomputes.
 *
 * Seats the game on a free, enabled court immediately if one is open;
 * otherwise it's created as UPCOMING like any other game, and will be
 * picked up next time a court frees up (assignAllFreeCourts in queue.ts).
 */
export async function createTiebreakGame(tournamentId: string, playerIds: string[]) {
  const uniqueIds = [...new Set(playerIds)];
  if (uniqueIds.length < 2) {
    throw new Error("a tiebreaker game needs at least 2 players");
  }

  const shuffled = shuffle(uniqueIds);
  const half = Math.ceil(shuffled.length / 2);
  const teamA = shuffled.slice(0, half);
  const teamB = shuffled.slice(half);

  const freeCourt = await prisma.court.findFirst({
    where: {
      tournamentId,
      isEnabled: true,
      games: { none: { status: { in: ["READY", "IN_PROGRESS", "PAUSED"] } } },
    },
  });

  const game = await prisma.game.create({
    data: {
      tournamentId,
      isTiebreaker: true,
      status: freeCourt ? "READY" : "UPCOMING",
      courtId: freeCourt?.id,
      players: {
        create: [
          ...teamA.map((playerId) => ({ playerId, team: "A" as const })),
          ...teamB.map((playerId) => ({ playerId, team: "B" as const })),
        ],
      },
    },
    include: { players: { include: { player: true } }, court: true },
  });

  await prisma.player.updateMany({
    where: { id: { in: uniqueIds } },
    data: { status: freeCourt ? "PLAYING" : "QUEUED" },
  });
  await prisma.queueEntry.deleteMany({ where: { playerId: { in: uniqueIds } } });

  return game;
}