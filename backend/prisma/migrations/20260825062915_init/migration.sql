-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "finalStandings" JSONB,
ADD COLUMN     "resultsFinalizedAt" TIMESTAMP(3),
ADD COLUMN     "scheduledEnd" TIMESTAMP(3),
ADD COLUMN     "scheduledStart" TIMESTAMP(3);
