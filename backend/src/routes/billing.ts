import { Router } from "express";
import { prisma } from "../lib/prisma";
import { attachUser, AuthedRequest, requireAuth, requireSuperAdmin } from "../lib/auth";

export const billingRouter = Router();

billingRouter.get("/plan", attachUser, requireAuth, async (req: AuthedRequest, res) => {
  const setting = await prisma.platformSetting.upsert({ where: { id: "platform" }, create: { id: "platform", monthlyPriceCents: Number(process.env.DEFAULT_MONTHLY_PRICE_CENTS || 0) }, update: {} });
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { subscriptionExpiresAt: true, subscriptionStatus: true, subscriptionPaymentStatus: true, subscriptionPaymentSubmittedAt: true, subscriptionPaymentProofStoredFile: true } });
  res.json({
    monthlyPriceCents: setting.monthlyPriceCents,
    subscriptionPaymentInstructions: setting.subscriptionPaymentInstructions,
    subscriptionExpiresAt: user?.subscriptionExpiresAt ?? null,
    subscriptionStatus: user?.subscriptionStatus ?? null,
    paymentStatus: user?.subscriptionPaymentStatus ?? null,
    paymentSubmittedAt: user?.subscriptionPaymentSubmittedAt ?? null,
    hasPaymentProof: !!user?.subscriptionPaymentProofStoredFile,
  });
});

billingRouter.get("/settings", attachUser, requireSuperAdmin, async (_req, res) => {
  const setting = await prisma.platformSetting.upsert({ where: { id: "platform" }, create: { id: "platform", monthlyPriceCents: Number(process.env.DEFAULT_MONTHLY_PRICE_CENTS || 0) }, update: {} });
  res.json({ monthlyPriceCents: setting.monthlyPriceCents, subscriptionPaymentInstructions: setting.subscriptionPaymentInstructions ?? "" });
});

billingRouter.patch("/settings", attachUser, requireSuperAdmin, async (req, res) => {
  const monthlyPriceCents = Number(req.body?.monthlyPriceCents);
  if (!Number.isInteger(monthlyPriceCents) || monthlyPriceCents < 0) return res.status(400).json({ error: "Price must be a non-negative whole number of cents." });
  const instructions = req.body?.subscriptionPaymentInstructions;
  if (instructions !== undefined && instructions !== null && (typeof instructions !== "string" || instructions.length > 3000)) {
    return res.status(400).json({ error: "Payment instructions must be 3000 characters or fewer." });
  }
  const setting = await prisma.platformSetting.upsert({
    where: { id: "platform" },
    create: { id: "platform", monthlyPriceCents, subscriptionPaymentInstructions: instructions ?? null },
    update: { monthlyPriceCents, ...(instructions !== undefined ? { subscriptionPaymentInstructions: instructions || null } : {}) },
  });
  res.json({ monthlyPriceCents: setting.monthlyPriceCents, subscriptionPaymentInstructions: setting.subscriptionPaymentInstructions ?? "" });
});