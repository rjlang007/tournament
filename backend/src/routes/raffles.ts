import { Router } from "express";
import { prisma } from "../lib/prisma";
import { attachUser, AuthedRequest, canManageTournament } from "../lib/auth";
import { broadcastTournamentUpdate } from "../socket";

export const rafflesRouter = Router();

const activeGameStatuses = ["READY", "IN_PROGRESS", "PAUSED"] as const;

async function getEligibleParticipants(tournamentId: string) {
  const games = await prisma.game.findMany({
    where: { tournamentId, status: { in: [...activeGameStatuses] } },
    select: { players: { select: { player: { select: { id: true, name: true } } } } },
  });

  const participants = new Map<string, { id: string; name: string }>();
  for (const game of games) {
    for (const gamePlayer of game.players) participants.set(gamePlayer.player.id, gamePlayer.player);
  }
  return [...participants.values()];
}

rafflesRouter.get("/:tournamentId", attachUser, async (req, res) => {
  const tournamentId = req.params.tournamentId;
  const [participants, latestDraw] = await Promise.all([
    getEligibleParticipants(tournamentId),
    prisma.raffleDraw.findFirst({ where: { tournamentId }, orderBy: { createdAt: "desc" } }),
  ]);
  res.json({ participants, latestDraw });
});

rafflesRouter.post("/:tournamentId/spin", attachUser, async (req: AuthedRequest, res) => {
  const tournamentId = req.params.tournamentId;
  if (!(await canManageTournament(req, tournamentId))) {
    return res.status(403).json({ error: "Only tournament administrators can start the raffle." });
  }

  const prizeDescription = typeof req.body.prizeDescription === "string" ? req.body.prizeDescription.trim() : "";
  if (!prizeDescription || prizeDescription.length > 160) {
    return res.status(400).json({ error: "A prize description between 1 and 160 characters is required." });
  }

  const participants = await getEligibleParticipants(tournamentId);
  if (participants.length === 0) {
    return res.status(400).json({ error: "There are no players in an active game to enter in the raffle." });
  }

  const winner = participants[Math.floor(Math.random() * participants.length)];
  const draw = await prisma.raffleDraw.create({
    data: {
      tournamentId,
      prizeDescription,
      winnerName: winner.name,
      participantNames: participants.map((participant) => participant.name),
    },
  });
  broadcastTournamentUpdate(tournamentId, "raffle:changed");
  broadcastTournamentUpdate(tournamentId, "raffle:won", { draw });
  res.status(201).json({ draw, participants });
});