ALTER TABLE "TournamentPhoto" ADD COLUMN "data" BYTEA;
ALTER TABLE "TournamentPhoto" ADD COLUMN "mimeType" TEXT;
ALTER TYPE "RegistrationStatus" ADD VALUE 'INVITED';

ALTER TABLE "RegistrationSubmission" ADD COLUMN "participantUserId" TEXT;
UPDATE "RegistrationSubmission" SET "participantUserId" = "userId";
DROP INDEX "RegistrationSubmission_postId_userId_key";
CREATE UNIQUE INDEX "RegistrationSubmission_postId_participantUserId_key"
  ON "RegistrationSubmission"("postId", "participantUserId");
CREATE INDEX "RegistrationSubmission_postId_userId_idx"
  ON "RegistrationSubmission"("postId", "userId");
ALTER TABLE "RegistrationSubmission"
  ADD CONSTRAINT "RegistrationSubmission_participantUserId_fkey"
  FOREIGN KEY ("participantUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
