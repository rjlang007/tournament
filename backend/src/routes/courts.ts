import { Router } from "express";
import { prisma } from "../lib/prisma";
import { broadcastTournamentUpdate } from "../socket";
import { assignAllFreeCourts } from "../lib/queue";

export const courtsRouter = Router();

// Add a court (system is responsive for 2+ courts, add as many as the venue has)
courtsRouter.post("/", async (req, res) => {
  const { tournamentId, label } = req.body;
  const court = await prisma.court.create({ data: { tournamentId, label } });
  broadcastTournamentUpdate(tournamentId, "courts:changed");
  res.status(201).json(court);
});

courtsRouter.get("/", async (req, res) => {
  const { tournamentId } = req.query;
  const courts = await prisma.court.findMany({
    where: { tournamentId: String(tournamentId) },
    include: { games: { where: { status: { in: ["READY", "IN_PROGRESS", "PAUSED"] } }, include: { players: { include: { player: true } } } } },
    orderBy: { label: "asc" },
  });
  res.json(courts);
});

// Enable/disable a court - disabling pulls it out of matchmaking rotation
// immediately (it stops receiving new games; a game already in progress on
// it is left for staff to finish/pause manually).
courtsRouter.patch("/:id/toggle", async (req, res) => {
  const { isEnabled } = req.body;
  const court = await prisma.court.update({
    where: { id: req.params.id },
    data: { isEnabled },
  });

  if (isEnabled) {
    await assignAllFreeCourts(court.tournamentId);
  }

  broadcastTournamentUpdate(court.tournamentId, "courts:changed");
  res.json(court);
});

courtsRouter.delete("/:id", async (req, res) => {
  const court = await prisma.court.delete({ where: { id: req.params.id } });
  broadcastTournamentUpdate(court.tournamentId, "courts:changed");
  res.status(204).send();
});
