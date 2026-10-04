import { recordAudit } from "./audit";
import { prisma } from "./prisma";

type TournamentChange = {
  tournamentId: string;
  actorId?: string | null;
  action: string;
  entityId?: string;
  summary: string;
  details?: unknown;
};

export async function recordTournamentChange(change: TournamentChange) {
  const audit = await recordAudit(prisma, {
    tournamentId: change.tournamentId,
    actorId: change.actorId,
    action: change.action,
    entityType: "Bracket",
    entityId: change.entityId,
    details: { summary: change.summary, ...(change.details && typeof change.details === "object" ? change.details as object : {}) },
  });

  await notifyTournamentParticipants(
    change.tournamentId,
    "Tournament bracket updated",
    change.summary,
    `/t/${change.tournamentId}/changes`,
  );

  return audit;
}

export async function notifyTournamentParticipants(tournamentId: string, title: string, message: string, actionUrl: string) {
  try {
    const [tournament, players] = await Promise.all([
      prisma.tournament.findUnique({ where: { id: tournamentId }, select: { ownerId: true } }),
      prisma.player.findMany({ where: { tournamentId, userId: { not: null } }, select: { userId: true } }),
    ]);
    const recipientIds = new Set(players.flatMap((player) => player.userId ? [player.userId] : []));
    if (tournament?.ownerId) recipientIds.add(tournament.ownerId);
    if (recipientIds.size > 0) {
      await prisma.notification.createMany({
        data: Array.from(recipientIds, (userId) => ({
          userId,
          type: "TOURNAMENT_CHANGE",
          title,
          message,
          actionUrl,
        })),
      });
    }
  } catch (error) {
    console.error("Failed to notify tournament participants about a change:", error);
  }
}
