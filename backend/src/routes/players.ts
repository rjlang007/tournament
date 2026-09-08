import { Router } from "express";
import { prisma } from "../lib/prisma";
import { enqueuePlayer } from "../lib/queue";
import { broadcastTournamentUpdate } from "../socket";
import { attachUser, AuthedRequest, canManageTournament } from "../lib/auth";

export const playersRouter = Router();

// Admin registration: name + skill level (BEGINNER / AVERAGE / ADVANCE)
playersRouter.post("/", async (req: AuthedRequest, res) => {
  const { tournamentId, name, contact, skillLevel } = req.body;
  if (!tournamentId || !name || !["BEGINNER", "AVERAGE", "ADVANCE"].includes(skillLevel)) {
    return res.status(400).json({ error: "tournamentId, name, and valid skillLevel are required" });
  }
  if (!(await canManageTournament(req, tournamentId))) return res.status(403).json({ error: "You can only edit players in tournaments you own." });
  const player = await prisma.player.create({
    data: { tournamentId, name, contact, skillLevel },
  });

  // For random-pairing tournaments, newly registered players go straight
  // into the waiting queue so they're eligible for the next draw.
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (tournament?.type === "RANDOM_PAIRING") {
    await enqueuePlayer(tournamentId, player.id);
  }

  broadcastTournamentUpdate(tournamentId, "players:changed");
  res.status(201).json(player);
});

playersRouter.get("/", attachUser, async (req: AuthedRequest, res) => {
  const { tournamentId } = req.query;
  const players = await prisma.player.findMany({
    where: {
      tournamentId: String(tournamentId),
      ...(req.query.mine === "true" && req.userId ? { userId: req.userId } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  res.json(players);
});

// Admin can edit skill level or mark a player as LEFT (opens them up for substitution elsewhere)
playersRouter.patch("/:id", async (req, res) => {
  const { skillLevel, status, name, contact } = req.body;
  const existing = await prisma.player.findUnique({ where: { id: req.params.id }, select: { tournamentId: true } });
  if (!existing) return res.status(404).json({ error: "Player not found." });
  if (!(await canManageTournament(req as AuthedRequest, existing.tournamentId))) return res.status(403).json({ error: "You can only edit players in tournaments you own." });
  const player = await prisma.player.update({
    where: { id: req.params.id },
    data: { skillLevel, status, name, contact },
  });
  if (status === "WAITING") {
    const tournament = await prisma.tournament.findUnique({ where: { id: player.tournamentId } });
    if (tournament?.type === "RANDOM_PAIRING" && player.joinStatus === "APPROVED") await enqueuePlayer(player.tournamentId, player.id);
  }
  broadcastTournamentUpdate(player.tournamentId, "players:changed");
  res.json(player);
});

playersRouter.patch("/:id/approval", async (req: AuthedRequest, res) => {
  const { joinStatus } = req.body;
  if (!["PENDING", "APPROVED", "REJECTED"].includes(joinStatus)) {
    return res.status(400).json({ error: "Invalid approval status." });
  }
  const existing = await prisma.player.findUnique({ where: { id: req.params.id }, select: { tournamentId: true } });
  if (!existing) return res.status(404).json({ error: "Player not found." });
  if (!(await canManageTournament(req, existing.tournamentId))) return res.status(403).json({ error: "You can only edit players in tournaments you own." });
  const player = await prisma.player.update({
    where: { id: req.params.id },
    data: { joinStatus },
  });
  if (joinStatus === "REJECTED") await prisma.queueEntry.deleteMany({ where: { tournamentId: player.tournamentId, playerId: player.id } });
  if (joinStatus === "APPROVED") {
    const tournament = await prisma.tournament.findUnique({ where: { id: player.tournamentId } });
    if (tournament?.type === "RANDOM_PAIRING") await enqueuePlayer(player.tournamentId, player.id);
  }
  broadcastTournamentUpdate(player.tournamentId, "players:changed");
  res.json(player);
});

async function permanentlyRemovePlayer(req: AuthedRequest, res: any) {
  const existing = await prisma.player.findUnique({ where: { id: req.params.id }, select: { tournamentId: true } });
  if (!existing) return res.status(404).json({ error: "Player not found." });
  if (!(await canManageTournament(req, existing.tournamentId))) return res.status(403).json({ error: "You can only remove players from tournaments you own." });

  await prisma.$transaction(async (transaction) => {
    await transaction.queueEntry.deleteMany({ where: { playerId: req.params.id } });
    await transaction.gamePlayer.deleteMany({ where: { playerId: req.params.id } });
    await transaction.bracketEntry.deleteMany({ where: { playerAId: req.params.id } });
    await transaction.bracketEntry.updateMany({ where: { playerBId: req.params.id }, data: { playerBId: null } });
    await transaction.player.delete({ where: { id: req.params.id } });
  });

  broadcastTournamentUpdate(existing.tournamentId, "players:changed");
  broadcastTournamentUpdate(existing.tournamentId, "queue:changed");
  res.json({ ok: true });
}

playersRouter.patch("/:id/remove", permanentlyRemovePlayer);

playersRouter.delete("/:id", async (req: AuthedRequest, res) => {
  return permanentlyRemovePlayer(req, res);
});
