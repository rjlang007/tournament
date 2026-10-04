import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { attachUser, requireAuth, AuthedRequest } from "../lib/auth";
import { uploadAvatar, AVATAR_DIR } from "../lib/uploads";
import { defaultAvatarUrl, isDefaultAvatarKey, DEFAULT_AVATAR_KEYS } from "../lib/defaultAvatars";
import { getPlayerStats } from "../lib/playerLeaderboard";

export const usersRouter = Router();

function toPublicProfile(user: {
  id: string;
  username: string;
  bio: string | null;
  avatarUrl: string | null;
  defaultAvatarKey: string;
  createdAt: Date;
}) {
  return {
    id: user.id,
    username: user.username,
    bio: user.bio ?? "",
    avatarUrl: user.avatarUrl ?? defaultAvatarUrl(user.defaultAvatarKey as any),
    memberSince: user.createdAt,
  };
}

// Every signed-in user can browse every other user's public profile
// (avatar + description) - directory-style, like a member list.
usersRouter.get("/", attachUser, requireAuth, async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { username: "asc" } });
  res.json(users.map(toPublicProfile));
});

usersRouter.get("/default-avatars", attachUser, requireAuth, (_req, res) => {
  res.json(DEFAULT_AVATAR_KEYS.map((key) => ({ key, url: defaultAvatarUrl(key) })));
});

usersRouter.get("/:username", attachUser, requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { username: req.params.username } });
  if (!user) return res.status(404).json({ error: "User not found." });
  const viewerId = (req as AuthedRequest).userId;
  if (viewerId && viewerId !== user.id) {
    await prisma.profileVisit.upsert({
      where: { profileId_visitorId: { profileId: user.id, visitorId: viewerId } },
      create: { profileId: user.id, visitorId: viewerId },
      update: { visitedAt: new Date() },
    });
  }

  const [playerStats, visits] = await Promise.all([
    getPlayerStats(user.id),
    viewerId === user.id
      ? prisma.profileVisit.findMany({
          where: { profileId: user.id },
          orderBy: { visitedAt: "desc" },
          include: { visitor: { select: { id: true, username: true, avatarUrl: true, defaultAvatarKey: true } } },
        })
      : Promise.resolve(null),
  ]);

  res.json({
    ...toPublicProfile(user),
    playerStats,
    ...(visits ? {
      visitors: visits.map(({ visitor, visitedAt }) => ({
        id: visitor.id,
        username: visitor.username,
        avatarUrl: visitor.avatarUrl ?? defaultAvatarUrl(visitor.defaultAvatarKey as any),
        visitedAt,
      })),
    } : {}),
  });
});

const updateProfileSchema = z.object({
  bio: z.string().max(500, "Description must be 500 characters or fewer.").optional(),
});

usersRouter.patch("/me", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const user = await prisma.user.update({
    where: { id: req.userId },
    data: { bio: parsed.data.bio },
  });
  res.json(toPublicProfile(user));
});

// Pick one of the built-in animal avatars instead of uploading a photo.
usersRouter.post("/me/default-avatar", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const key = req.body?.key;
  if (typeof key !== "string" || !isDefaultAvatarKey(key)) {
    return res.status(400).json({ error: "Unknown default avatar." });
  }

  const current = await prisma.user.findUnique({ where: { id: req.userId } });
  if (current?.avatarUrl) {
    await deleteOwnedAvatarFile(current.avatarUrl);
  }

  const user = await prisma.user.update({
    where: { id: req.userId },
    data: { defaultAvatarKey: key, avatarUrl: null },
  });
  res.json(toPublicProfile(user));
});

// Uploaded profile pictures are stored permanently on this server's disk
// under backend/uploads/avatars and are never auto-deleted (unlike
// tournament photos, which are wiped after 14 days).
usersRouter.post(
  "/me/avatar",
  attachUser,
  requireAuth,
  uploadAvatar.single("avatar"),
  async (req: AuthedRequest, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No image file was uploaded." });
    }

    const current = await prisma.user.findUnique({ where: { id: req.userId } });
    if (current?.avatarUrl) {
      await deleteOwnedAvatarFile(current.avatarUrl);
    }

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { avatarUrl },
    });
    res.json(toPublicProfile(user));
  }
);

async function deleteOwnedAvatarFile(avatarUrl: string) {
  if (!avatarUrl.startsWith("/uploads/avatars/")) return; // was a default icon, nothing on disk to remove
  const filename = path.basename(avatarUrl);
  try {
    await fs.unlink(path.join(AVATAR_DIR, filename));
  } catch (err: any) {
    if (err?.code !== "ENOENT") console.error("Failed to delete old avatar:", err);
  }
}
