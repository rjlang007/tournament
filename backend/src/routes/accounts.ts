import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { attachUser, hashPassword, requireAuth, requireAdmin, requireSuperAdmin, AuthedRequest } from "../lib/auth";
import { randomDefaultAvatarKey, defaultAvatarUrl } from "../lib/defaultAvatars";
import { TOURNAMENT_PHOTO_DIR, uploadPaymentProof } from "../lib/uploads";

export const accountsRouter = Router();
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const createAccountSchema = z.object({
  username: z.string().regex(USERNAME_RE),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "PLAYER"]),
});

accountsRouter.get("/", attachUser, requireSuperAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "PLAYER"] } },
    orderBy: [{ role: "asc" }, { username: "asc" }],
    select: { id: true, username: true, role: true, createdAt: true, trialStartedAt: true, subscriptionExpiresAt: true, subscriptionStatus: true, subscriptionPaymentStatus: true, subscriptionPaymentSubmittedAt: true, subscriptionPaymentProofStoredFile: true },
  });
  res.json(users.map(({ subscriptionPaymentProofStoredFile, ...user }) => ({ ...user, hasSubscriptionPaymentProof: !!subscriptionPaymentProofStoredFile })));
});

accountsRouter.post("/", attachUser, requireSuperAdmin, async (req: AuthedRequest, res) => {
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

accountsRouter.post("/become-organizer", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true } });
  if (!user) return res.status(404).json({ error: "Account not found." });
  if (user.role !== "PLAYER") return res.status(409).json({ error: "This account already has organizer access." });

  const now = new Date();
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      role: "ADMIN",
      trialStartedAt: now,
      subscriptionExpiresAt: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000),
      subscriptionStatus: "TRIAL",
    },
  });
  res.json({ role: updated.role, trialStartedAt: updated.trialStartedAt, subscriptionExpiresAt: updated.subscriptionExpiresAt, subscriptionStatus: updated.subscriptionStatus });
});

accountsRouter.post("/subscription-payment-proof", attachUser, requireAuth, uploadPaymentProof.single("proof"), async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { role: true, subscriptionPaymentProofStoredFile: true } });
  if (!user || user.role !== "ADMIN") return res.status(403).json({ error: "Only organizer accounts can submit renewal proof." });
  if (!req.file) return res.status(400).json({ error: "Payment proof image is required." });
  const updated = await prisma.user.update({
    where: { id: req.userId! },
    data: { subscriptionPaymentProofStoredFile: req.file.filename, subscriptionPaymentSubmittedAt: new Date(), subscriptionPaymentStatus: "PENDING" },
  });
  if (user.subscriptionPaymentProofStoredFile) await unlinkPaymentProof(user.subscriptionPaymentProofStoredFile);
  res.json({ paymentStatus: updated.subscriptionPaymentStatus, paymentSubmittedAt: updated.subscriptionPaymentSubmittedAt });
});

accountsRouter.get("/:id/subscription-payment-proof", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const [account, viewer] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, subscriptionPaymentProofStoredFile: true } }),
    prisma.user.findUnique({ where: { id: req.userId! }, select: { role: true } }),
  ]);
  if (!account?.subscriptionPaymentProofStoredFile) return res.status(404).json({ error: "Subscription payment proof not found." });
  if (account.id !== req.userId && viewer?.role !== "SUPERADMIN") return res.status(403).json({ error: "You cannot view this payment proof." });
  return res.sendFile(path.join(path.dirname(TOURNAMENT_PHOTO_DIR), "payments", account.subscriptionPaymentProofStoredFile));
});

accountsRouter.patch("/:id/approve-payment", attachUser, requireSuperAdmin, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user || user.role !== "ADMIN") return res.status(404).json({ error: "Administrator account not found." });
  const now = new Date();
  const base = user.subscriptionExpiresAt && user.subscriptionExpiresAt > now ? user.subscriptionExpiresAt : now;
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { subscriptionExpiresAt: new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000), subscriptionStatus: "ACTIVE", ...(user.subscriptionPaymentProofStoredFile ? { subscriptionPaymentStatus: "APPROVED" as const } : {}) },
  });
  res.json({ id: updated.id, username: updated.username, subscriptionExpiresAt: updated.subscriptionExpiresAt, subscriptionStatus: updated.subscriptionStatus });
});

accountsRouter.patch("/:id/reject-payment", attachUser, requireSuperAdmin, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id, role: "ADMIN" } });
  if (!user) return res.status(404).json({ error: "Organizer account not found." });
  const updated = await prisma.user.update({ where: { id: user.id }, data: { subscriptionPaymentStatus: "REJECTED" } });
  res.json({ id: updated.id, subscriptionPaymentStatus: updated.subscriptionPaymentStatus });
});

async function unlinkPaymentProof(storedFile: string) {
  try {
    await fs.unlink(path.join(path.dirname(TOURNAMENT_PHOTO_DIR), "payments", storedFile));
  } catch (err: any) {
    if (err?.code !== "ENOENT") console.error("Failed to replace subscription payment proof:", err);
  }
}