import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  hashPassword,
  verifyPassword,
  signSession,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireAuth,
  refreshSubscriptionStatus,
  AuthedRequest,
} from "../lib/auth";
import { randomDefaultAvatarKey, defaultAvatarUrl } from "../lib/defaultAvatars";

export const authRouter = Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

const registerSchema = z.object({
  username: z.string().regex(USERNAME_RE, "3-20 characters: letters, numbers, underscore only."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  role: z.enum(["ADMIN", "PLAYER"]).default("PLAYER"),
});

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { username, password, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return res.status(409).json({ error: "That username is already taken." });
  }

  const passwordHash = await hashPassword(password);
  const accountCount = await prisma.user.count();
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      defaultAvatarKey: randomDefaultAvatarKey(),
      role: accountCount === 0 ? "SUPERADMIN" : role,
      ...(accountCount > 0 && role === "ADMIN" ? {
        trialStartedAt: new Date(),
        subscriptionExpiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        subscriptionStatus: "TRIAL" as const,
      } : {}),
    },
  });

  const currentUser = await refreshSubscriptionStatus(user);
  if (currentUser.role === "ADMIN" && currentUser.subscriptionStatus === "SUSPENDED") {
    return res.status(402).json({ error: "Your administrator subscription has expired.", subscriptionExpired: true, expiresAt: currentUser.subscriptionExpiresAt });
  }
  const token = signSession(user.id);
  setSessionCookie(res, token);
  res.status(201).json(publicUser(user));
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Username and password are required." });
  }
  const { username, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }

  const currentUser = await refreshSubscriptionStatus(user);
  if (currentUser.role === "ADMIN" && currentUser.subscriptionStatus === "SUSPENDED") {
    return res.status(402).json({ error: "Your administrator subscription has expired.", subscriptionExpired: true, expiresAt: currentUser.subscriptionExpiresAt });
  }
  const token = signSession(user.id);
  setSessionCookie(res, token);
  res.json(publicUser(user));
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: "Account not found." });
  res.json(publicUser(user));
});

// Shared shape returned for "me" / own account. Public profile viewing
// (routes/users.ts) uses a stricter, more limited shape.
function publicUser(user: {
  id: string;
  username: string;
  bio: string | null;
  avatarUrl: string | null;
  defaultAvatarKey: string;
  role: "SUPERADMIN" | "ADMIN" | "PLAYER";
  trialStartedAt?: Date | null;
  subscriptionExpiresAt?: Date | null;
  subscriptionStatus?: "TRIAL" | "ACTIVE" | "EXPIRED" | "SUSPENDED" | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    username: user.username,
    bio: user.bio ?? "",
    avatarUrl: user.avatarUrl ?? defaultAvatarUrl(user.defaultAvatarKey as any),
    role: user.role,
    trialStartedAt: user.trialStartedAt ?? null,
    subscriptionExpiresAt: user.subscriptionExpiresAt ?? null,
    subscriptionStatus: user.subscriptionStatus ?? null,
    createdAt: user.createdAt,
  };
}
