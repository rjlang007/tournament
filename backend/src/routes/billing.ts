import { Router } from "express";
import { prisma } from "../lib/prisma";
import { attachUser, requireSuperAdmin } from "../lib/auth";

export const billingRouter = Router();
billingRouter.use(attachUser, requireSuperAdmin);

billingRouter.get("/settings", async (_req, res) => {
  const setting = await prisma.platformSetting.upsert({ where: { id: "platform" }, create: { id: "platform", monthlyPriceCents: Number(process.env.DEFAULT_MONTHLY_PRICE_CENTS || 0) }, update: {} });
  res.json({ monthlyPriceCents: setting.monthlyPriceCents });
});

billingRouter.patch("/settings", async (req, res) => {
  const monthlyPriceCents = Number(req.body?.monthlyPriceCents);
  if (!Number.isInteger(monthlyPriceCents) || monthlyPriceCents < 0) return res.status(400).json({ error: "Price must be a non-negative whole number of cents." });
  const setting = await prisma.platformSetting.upsert({ where: { id: "platform" }, create: { id: "platform", monthlyPriceCents }, update: { monthlyPriceCents } });
  res.json({ monthlyPriceCents: setting.monthlyPriceCents });
});