CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED');

ALTER TABLE "User" ADD COLUMN "trialStartedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "subscriptionExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "subscriptionStatus" "SubscriptionStatus";

UPDATE "User"
SET "trialStartedAt" = "createdAt",
    "subscriptionExpiresAt" = "createdAt" + INTERVAL '15 days',
    "subscriptionStatus" = 'TRIAL'
WHERE "role" = 'ADMIN';

CREATE TABLE "PlatformSetting" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "monthlyPriceCents" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "PlatformSetting" ("id", "monthlyPriceCents", "updatedAt") VALUES ('platform', 0, CURRENT_TIMESTAMP);