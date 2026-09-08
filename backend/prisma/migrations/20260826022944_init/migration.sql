-- CreateEnum
CREATE TYPE "BracketFormat" AS ENUM ('SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'ROUND_ROBIN');

-- DropIndex
DROP INDEX "BracketMatch_bracketId_round_idx";

-- AlterTable
ALTER TABLE "Bracket" ADD COLUMN     "format" "BracketFormat" NOT NULL DEFAULT 'SINGLE_ELIMINATION';

-- AlterTable
ALTER TABLE "BracketMatch" ADD COLUMN     "bracketSide" TEXT NOT NULL DEFAULT 'WINNERS',
ADD COLUMN     "label" TEXT,
ADD COLUMN     "loserNextMatchId" TEXT,
ADD COLUMN     "loserNextSlot" TEXT,
ADD COLUMN     "nextSlot" TEXT,
ADD COLUMN     "winnerEntryId" TEXT;

-- CreateIndex
CREATE INDEX "BracketMatch_bracketId_bracketSide_round_idx" ON "BracketMatch"("bracketId", "bracketSide", "round");
