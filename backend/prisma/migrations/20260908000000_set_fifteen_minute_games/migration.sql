ALTER TABLE "Game" ALTER COLUMN "durationSeconds" SET DEFAULT 900;
ALTER TABLE "Game" ALTER COLUMN "remainingSeconds" SET DEFAULT 900;

UPDATE "Game"
SET "durationSeconds" = 900,
    "remainingSeconds" = 900
WHERE "status" IN ('UPCOMING', 'READY');