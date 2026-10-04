ALTER TABLE "ProfileVisit" ALTER COLUMN "visitorId" DROP NOT NULL;
ALTER TABLE "ProfileVisit" ADD COLUMN "visitorKey" TEXT;

UPDATE "ProfileVisit"
SET "visitorKey" = 'user:' || "visitorId";

ALTER TABLE "ProfileVisit" ALTER COLUMN "visitorKey" SET NOT NULL;
DROP INDEX "ProfileVisit_profileId_visitorId_key";
CREATE UNIQUE INDEX "ProfileVisit_profileId_visitorKey_key" ON "ProfileVisit"("profileId", "visitorKey");
