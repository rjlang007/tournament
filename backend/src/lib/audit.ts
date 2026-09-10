import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

type AuditDatabase = typeof prisma | Prisma.TransactionClient;

export function recordAudit(
  db: AuditDatabase,
  data: {
    tournamentId: string;
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    details?: unknown;
  }
) {
  return db.auditLog.create({
    data: {
      tournamentId: data.tournamentId,
      actorId: data.actorId ?? null,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId ?? null,
      details: data.details === undefined ? undefined : data.details as Prisma.InputJsonValue,
    },
  });
}