CREATE TABLE "RaffleDraw" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "prizeDescription" TEXT NOT NULL,
    "winnerName" TEXT NOT NULL,
    "participantNames" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaffleDraw_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RaffleDraw_tournamentId_createdAt_idx" ON "RaffleDraw"("tournamentId", "createdAt");

ALTER TABLE "RaffleDraw" ADD CONSTRAINT "RaffleDraw_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;