ALTER TABLE "TournamentPost" ADD COLUMN "divisions" JSONB;
ALTER TABLE "TournamentPost" ADD COLUMN "paymentMethods" JSONB;
ALTER TABLE "TournamentPost" ADD COLUMN "paymentQrStoredFile" TEXT;
ALTER TABLE "RegistrationSubmission" ADD COLUMN "division" TEXT;
ALTER TABLE "RegistrationSubmission" ADD COLUMN "paymentMethod" TEXT;