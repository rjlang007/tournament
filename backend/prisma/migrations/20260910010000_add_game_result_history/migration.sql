CREATE TABLE "GameResultHistory" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "actorId" TEXT,
    "winningTeam" "GameTeam" NOT NULL,
    "scoreA" INTEGER NOT NULL,
    "scoreB" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameResultHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GameResultHistory_gameId_createdAt_idx" ON "GameResultHistory"("gameId", "createdAt");
CREATE INDEX "GameResultHistory_actorId_idx" ON "GameResultHistory"("actorId");
ALTER TABLE "GameResultHistory" ADD CONSTRAINT "GameResultHistory_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameResultHistory" ADD CONSTRAINT "GameResultHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;