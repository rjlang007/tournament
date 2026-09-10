CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "TournamentPost" ADD COLUMN "tournamentId" TEXT;
ALTER TABLE "RegistrationSubmission" ADD COLUMN "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "RegistrationSubmission" ADD COLUMN "applicantName" TEXT;
ALTER TABLE "RegistrationSubmission" ADD COLUMN "skillLevel" "SkillLevel";
ALTER TABLE "RegistrationSubmission" ADD COLUMN "contact" TEXT;
ALTER TABLE "RegistrationSubmission" ADD COLUMN "paymentProofUrl" TEXT;
ALTER TABLE "RegistrationSubmission" ADD COLUMN "paymentProofStoredFile" TEXT;

UPDATE "RegistrationSubmission" s SET "applicantName" = u."username", "skillLevel" = 'BEGINNER' FROM "User" u WHERE u."id" = s."userId";
ALTER TABLE "RegistrationSubmission" ALTER COLUMN "applicantName" SET NOT NULL;
ALTER TABLE "RegistrationSubmission" ALTER COLUMN "skillLevel" SET NOT NULL;

CREATE INDEX "TournamentPost_tournamentId_idx" ON "TournamentPost"("tournamentId");
CREATE INDEX "RegistrationSubmission_postId_status_idx" ON "RegistrationSubmission"("postId", "status");
ALTER TABLE "TournamentPost" ADD CONSTRAINT "TournamentPost_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;