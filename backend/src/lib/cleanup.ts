import fs from "fs/promises";
import path from "path";
import cron from "node-cron";
import { prisma } from "./prisma";
import { TOURNAMENT_PHOTO_DIR } from "./uploads";

export const PHOTO_LIFETIME_DAYS = 14;

// Deletes the disk file + DB row for every tournament photo uploaded more
// than PHOTO_LIFETIME_DAYS ago. Never touches user avatars, which live in
// a separate directory and table entirely.
export async function deleteExpiredTournamentPhotos(): Promise<number> {
  const cutoff = new Date(Date.now() - PHOTO_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

  const expired = await prisma.tournamentPhoto.findMany({
    where: { uploadedAt: { lte: cutoff } },
  });

  for (const photo of expired) {
    const filePath = path.join(TOURNAMENT_PHOTO_DIR, photo.storedFile);
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        console.error(`Failed to delete tournament photo file ${filePath}:`, err);
      }
    }
  }

  if (expired.length > 0) {
    await prisma.tournamentPhoto.deleteMany({
      where: { id: { in: expired.map((p: { id: string }) => p.id) } },
    });
  }

  return expired.length;
}

// Runs once at startup (catches anything missed while the server was down)
// and then every hour on the hour.
export function startPhotoCleanupJob() {
  deleteExpiredTournamentPhotos()
    .then((n) => n > 0 && console.log(`[cleanup] removed ${n} expired tournament photo(s) on startup`))
    .catch((err) => console.error("[cleanup] startup run failed:", err));

  cron.schedule("0 * * * *", async () => {
    try {
      const n = await deleteExpiredTournamentPhotos();
      if (n > 0) console.log(`[cleanup] removed ${n} expired tournament photo(s)`);
    } catch (err) {
      console.error("[cleanup] scheduled run failed:", err);
    }
  });
}
