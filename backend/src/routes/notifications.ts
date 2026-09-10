import { Router } from "express";
import { prisma } from "../lib/prisma";
import { attachUser, requireAuth, AuthedRequest } from "../lib/auth";

export const notificationsRouter = Router();
notificationsRouter.use(attachUser, requireAuth);

notificationsRouter.get("/", async (req: AuthedRequest, res) => {
  const notifications = await prisma.notification.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" }, take: 50 });
  res.json(notifications);
});

notificationsRouter.patch("/:id/read", async (req: AuthedRequest, res) => {
  const notification = await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.userId }, data: { readAt: new Date() } });
  if (notification.count !== 1) return res.status(404).json({ error: "Notification not found." });
  res.json({ ok: true });
});
