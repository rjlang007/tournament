CREATE TYPE "UserRole_new" AS ENUM ('SUPERADMIN', 'ADMIN', 'PLAYER');

ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'PLAYER';

ALTER TABLE "Player" ADD COLUMN "userId" TEXT;
ALTER TABLE "Tournament" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Player" ADD CONSTRAINT "Player_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Player_tournamentId_userId_key" ON "Player"("tournamentId", "userId");
CREATE INDEX "Tournament_ownerId_idx" ON "Tournament"("ownerId");

UPDATE "User" SET "role" = 'SUPERADMIN' WHERE "id" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1);