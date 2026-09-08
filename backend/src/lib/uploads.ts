import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuid } from "uuid";

export const AVATAR_DIR = path.join(__dirname, "..", "..", "uploads", "avatars");
export const TOURNAMENT_PHOTO_DIR = path.join(__dirname, "..", "..", "uploads", "tournaments");

for (const dir of [AVATAR_DIR, TOURNAMENT_PHOTO_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function imageFileFilter(_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new Error("Only JPEG, PNG, WEBP, or GIF images are allowed."));
  }
  cb(null, true);
}

function makeStorage(dir: string) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${uuid()}${ext}`);
    },
  });
}

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB

export const uploadAvatar = multer({
  storage: makeStorage(AVATAR_DIR),
  fileFilter: imageFileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
});

export const uploadTournamentPhotos = multer({
  storage: makeStorage(TOURNAMENT_PHOTO_DIR),
  fileFilter: imageFileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 8 },
});
