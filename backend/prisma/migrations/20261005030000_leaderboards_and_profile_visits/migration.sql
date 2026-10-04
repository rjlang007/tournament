CREATE TABLE "ProfileVisit" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileVisit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProfileVisit_profileId_visitorId_key" ON "ProfileVisit"("profileId", "visitorId");
CREATE INDEX "ProfileVisit_profileId_visitedAt_idx" ON "ProfileVisit"("profileId", "visitedAt");

ALTER TABLE "ProfileVisit" ADD CONSTRAINT "ProfileVisit_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProfileVisit" ADD CONSTRAINT "ProfileVisit_visitorId_fkey"
FOREIGN KEY ("visitorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
