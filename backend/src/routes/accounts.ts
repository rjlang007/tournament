import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { attachUser, hashPassword, requireAdmin, requireSuperAdmin, AuthedRequest } from "../lib/auth";
import { randomDefaultAvatarKey, defaultAvatarUrl } from "../lib/defaultAvatars";

export const accountsRouter = Router();
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const createAccountSchema = z.object({
  username: z.string().regex(USERNAME_RE),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "PLAYER"]),
});

accountsRouter.get("/", attachUser, requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "PLAYER"] } },
    orderBy: [{ role: "asc" }, { username: "asc" }],
    select: { id: true, username: true, role: true, createdAt: true, trialStartedAt: true, subscriptionExpiresAt: true, subscriptionStatus: true },
  });
  res.json(users);
});

accountsRouter.post("/", attachUser, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = createAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { username, password, role } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return res.status(409).json({ error: "That username is already taken." });

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await hashPassword(password),
      role,
      defaultAvatarKey: randomDefaultAvatarKey(),
      ...(role === "ADMIN" ? {
        trialStartedAt: new Date(),
        subscriptionExpiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        subscriptionStatus: "TRIAL" as const,
      } : {}),
    },
  });
  res.status(201).json({
    id: user.id,
    username: user.username,
    role: user.role,
    avatarUrl: defaultAvatarUrl(user.defaultAvatarKey as any),
    createdAt: user.createdAt,
    trialStartedAt: user.trialStartedAt,
    subscriptionExpiresAt: user.subscriptionExpiresAt,
    subscriptionStatus: user.subscriptionStatus,
  });
});

accountsRouter.patch("/:id/approve-payment", attachUser, requireSuperAdmin, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user || user.role !== "ADMIN") return res.status(404).json({ error: "Administrator account not found." });
  const now = new Date();
  const base = user.subscriptionExpiresAt && user.subscriptionExpiresAt > now ? user.subscriptionExpiresAt : now;
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { subscriptionExpiresAt: new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000), subscriptionStatus: "ACTIVE" },
  });
  res.json({ id: updated.id, username: updated.username, subscriptionExpiresAt: updated.subscriptionExpiresAt, subscriptionStatus: updated.subscriptionStatus });
});