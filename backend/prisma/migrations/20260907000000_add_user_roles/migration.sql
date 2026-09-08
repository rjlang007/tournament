CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'PLAYER');

ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'PLAYER';

UPDATE "User"
SET "role" = 'ADMIN'
WHERE "id" = (
  SELECT "id" FROM "User" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1
);