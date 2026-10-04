import { Router } from "express";
import { prisma } from "../lib/prisma";
import { computeLeaderboard } from "../lib/leaderboard";
import { getPlayerLeaderboard } from "../lib/playerLeaderboard";

export const leaderboardRouter = Router();

// Player career rankings are based on officially finalized event podiums.
leaderboardRouter.get("/global", async (_req, res) => {
  const rows = await getPlayerLeaderboard();
  const byPoints = (points: (row: typeof rows[number]) => number) =>
    [...rows].sort((a, b) =>
      points(b) - points(a) || b.winRate - a.winRate || b.wins - a.wins || a.username.localeCompare(b.username)
    );

  res.json({
    openPlay: byPoints((row) => row.openPlayPoints),
    tournaments: byPoints((row) => row.tournamentPoints),
    overall: byPoints((row) => row.overallPoints),
  });
});

// Live, always-current standings (keeps updating as games finish).
leaderboardRouter.get("/:tournamentId", async (req, res) => {
  const leaderboard = await computeLeaderboard(req.params.tournamentId);
  res.json(leaderboard);
});

// The officially recorded/frozen standings, set either when the operator
// hits "Finalize now" or automatically when the tournament's scheduled end
// time passes (see the timer tick in index.ts). Null standings/finalized
// false means the tournament hasn't been locked in yet.
leaderboardRouter.get("/:tournamentId/final", async (req, res) => {
  const tournament = await prisma.tournament.findUniqueOrThrow({
    where: { id: req.params.tournamentId },
    select: { name: true, resultsFinalizedAt: true, finalStandings: true },
  });
  res.json({
    tournamentName: tournament.name,
    finalized: !!tournament.resultsFinalizedAt,
    finalizedAt: tournament.resultsFinalizedAt,
    standings: tournament.finalStandings ?? null,
  });
});
