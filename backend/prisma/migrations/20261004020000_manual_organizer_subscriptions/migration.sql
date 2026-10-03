ALTER TABLE "User" ADD COLUMN "subscriptionPaymentProofStoredFile" TEXT;
ALTER TABLE "User" ADD COLUMN "subscriptionPaymentSubmittedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "subscriptionPaymentStatus" "RegistrationStatus";
ALTER TABLE "PlatformSetting" ADD COLUMN "subscriptionPaymentInstructions" TEXT;