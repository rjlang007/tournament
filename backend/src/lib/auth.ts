import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret";
const COOKIE_NAME = "session_token";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function refreshSubscriptionStatus(user: {
  id: string;
  role: "SUPERADMIN" | "ADMIN" | "PLAYER";
  subscriptionExpiresAt: Date | null;
  subscriptionStatus: "TRIAL" | "ACTIVE" | "EXPIRED" | "SUSPENDED" | null;
}) {
  if (user.role !== "ADMIN" || !user.subscriptionExpiresAt) return user;
  if (user.subscriptionExpiresAt > new Date() || user.subscriptionStatus === "EXPIRED") {
    if (user.subscriptionExpiresAt > new Date() && user.subscriptionStatus === "EXPIRED") {
      const { prisma } = await import("./prisma.js");
      return prisma.user.update({ where: { id: user.id }, data: { subscriptionStatus: "ACTIVE" } });
    }
    return user;
  }
  if (user.subscriptionStatus !== "SUSPENDED") {
    const { prisma } = await import("./prisma.js");
    return prisma.user.update({ where: { id: user.id }, data: { subscriptionStatus: "SUSPENDED" } });
  }
  return user;
}

export function signSession(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "30d" });
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME);
}

export interface AuthedRequest extends Request {
  userId?: string;
  userRole?: "SUPERADMIN" | "ADMIN" | "PLAYER";
}

export async function canManageTournament(req: AuthedRequest, tournamentId: string) {
  if (!req.userId) return false;
  const { prisma } = await import("./prisma.js");
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } });
  if (user?.role === "SUPERADMIN") return true;
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { ownerId: true } });
  return user?.role === "ADMIN" && tournament?.ownerId === req.userId;
}

// Attaches req.userId if a valid session cookie is present, but does not
// reject the request. Use `requireAuth` below to enforce login.
export function attachUser(req: AuthedRequest, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
      req.userId = payload.sub;
    } catch {
      // ignore invalid/expired token - request proceeds unauthenticated
    }
  }
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.userId) {
    return res.status(401).json({ error: "Not signed in." });
  }
  import("./prisma.js").then(async ({ prisma }) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true, subscriptionExpiresAt: true, subscriptionStatus: true } });
    if (!user) return res.status(401).json({ error: "Account not found." });
    if (user.role === "ADMIN" && user.subscriptionExpiresAt && user.subscriptionExpiresAt <= new Date()) {
      if (user.subscriptionStatus !== "SUSPENDED") await prisma.user.update({ where: { id: user.id }, data: { subscriptionStatus: "SUSPENDED" } });
      return res.status(402).json({ error: "Your administrator subscription has expired.", subscriptionExpired: true, expiresAt: user.subscriptionExpiresAt });
    }
    next();
  }).catch(next);
}

export async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.userId) {
    return res.status(401).json({ error: "Not signed in." });
  }
  const { prisma } = await import("./prisma.js");
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } });
  if (!user || !["SUPERADMIN", "ADMIN"].includes(user.role)) {
    return res.status(403).json({ error: "Administrator access is required." });
  }
  req.userRole = user.role;
  next();
}

export async function requireSuperAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.userId) return res.status(401).json({ error: "Not signed in." });
  const { prisma } = await import("./prisma.js");
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } });
  if (!user || user.role !== "SUPERADMIN") {
    return res.status(403).json({ error: "Platform owner access is required." });
  }
  req.userRole = user.role;
  next();
}
