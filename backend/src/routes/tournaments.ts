import { Router } from "express";
import { prisma } from "../lib/prisma";
import { computeLeaderboard, countUnfinishedGames, detectPodiumTies, LeaderboardRow } from "../lib/leaderboard";
import { createTiebreakGame } from "../lib/tiebreak";
import { broadcastTournamentUpdate } from "../socket";
import { attachUser, AuthedRequest, canManageTournament } from "../lib/auth";

export const tournamentsRouter = Router();

// Create a tournament - type is RANDOM_PAIRING or FIXED_BRACKET
tournamentsRouter.post("/", async (req: AuthedRequest, res) => {
  const { name, type } = req.body;
  if (!name || !["RANDOM_PAIRING", "FIXED_BRACKET"].includes(type)) {
    return res.status(400).json({ error: "name and valid type are required" });
  }
  const tournament = await prisma.tournament.create({ data: { name, type, ownerId: req.userId } });
  res.status(201).json(tournament);
});

tournamentsRouter.get("/", async (req: AuthedRequest, res) => {
  const tournaments = await prisma.tournament.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      players: { where: { userId: req.userId ?? "" }, select: { joinStatus: true, status: true } },
    },
  });
  res.json(tournaments.map(({ players, ...tournament }) => ({
    ...tournament,
    myMembership: players[0] ?? null,
  })));
});

tournamentsRouter.get("/:id", async (req, res) => {
  const tournament = await prisma.tournament.findUnique({
    where: { id: req.params.id },
    include: { courts: true, players: true },
  });
  if (!tournament) return res.status(404).json({ error: "not found" });
  res.json(tournament);
});

tournamentsRouter.patch("/:id/status", async (req: AuthedRequest, res) => {
  if (!(await canManageTournament(req, req.params.id))) return res.status(403).json({ error: "You can only edit tournaments you own." });
  const { status } = req.body;
  if (!["SETUP", "ACTIVE", "COMPLETED"].includes(status)) {
    return res.status(400).json({ error: "invalid status" });
  }
  const tournament = await prisma.tournament.update({
    where: { id: req.params.id },
    data: { status },
  });
  res.json(tournament);
});

tournamentsRouter.post("/:id/complete", async (req: AuthedRequest, res) => {
  if (!(await canManageTournament(req, req.params.id))) return res.status(403).json({ error: "You can only finish tournaments you own." });
  const unfinishedGames = await countUnfinishedGames(req.params.id);
  if (unfinishedGames > 0) {
    return res.status(409).json({ error: "Finish or cancel all queued and active games before finalizing.", unfinishedGames });
  }
  const standings = await computeLeaderboard(req.params.id);
  const ties = detectPodiumTies(standings);
  if (ties.length > 0) {
    return res.status(409).json({
      error: "Resolve the podium tie before finalizing this tournament.",
      ties,
      standings,
    });
  }
  const tournament = await prisma.tournament.update({
    where: { id: req.params.id },
    data: { status: "COMPLETED", resultsFinalizedAt: new Date(), finalStandings: standings as any },
  });
  broadcastTournamentUpdate(tournament.id, "tournament:changed");
  res.json(tournament);
});

tournamentsRouter.delete("/:id", async (req: AuthedRequest, res) => {
  if (!(await canManageTournament(req, req.params.id))) return res.status(403).json({ error: "You can only remove tournaments you own." });
  const tournament = await prisma.tournament.delete({ where: { id: req.params.id } });
  broadcastTournamentUpdate(tournament.id, "tournament:deleted");
  res.json({ ok: true });
});

tournamentsRouter.get("/:id/summary.csv", async (req: AuthedRequest, res) => {
  if (!(await canManageTournament(req, req.params.id))) return res.status(403).json({ error: "You can only download summaries for tournaments you own." });
  const tournament = await prisma.tournament.findUnique({ where: { id: req.params.id } });
  if (!tournament) return res.status(404).json({ error: "Tournament not found." });
  if (tournament.status !== "COMPLETED") return res.status(400).json({ error: "Finish the tournament before downloading its summary." });

  const standings = Array.isArray(tournament.finalStandings)
    ? tournament.finalStandings as unknown as LeaderboardRow[]
    : await computeLeaderboard(tournament.id);
  const games = await prisma.game.findMany({
    where: { tournamentId: tournament.id },
    include: { players: { include: { player: true } } },
    orderBy: { createdAt: "asc" },
  });

  const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const placement = (rank: number) => rank === 1 ? "Champion" : rank === 2 ? "1st Runner-up" : rank === 3 ? "2nd Runner-up" : `Rank ${rank}`;
  const lines = [
    ["Tournament Summary", tournament.name].map(csvCell).join(","),
    ["Status", "FINISHED"].map(csvCell).join(","),
    ["Finished At", tournament.resultsFinalizedAt?.toISOString() ?? ""].map(csvCell).join(","),
    "",
    ["Final Rankings", "", "", "", "", "", ""].map(csvCell).join(","),
    ["Rank", "Placement", "Player", "Skill Level", "Games Played", "Wins", "Losses", "Win %"].map(csvCell).join(","),
    ...standings.map((row, index) => [index + 1, placement(index + 1), row.name, row.skillLevel, row.gamesPlayed, row.wins, row.losses, row.winPct].map(csvCell).join(",")),
    "",
    ["Recorded Games", "", "", "", "", "", ""].map(csvCell).join(","),
    ["Match", "Status", "Team A", "Team B", "Score A", "Score B", "Winner"].map(csvCell).join(","),
    ...games.map((game, index) => {
      const teamA = game.players.filter((player) => player.team === "A").map((player) => player.player.name).join(" & ");
      const teamB = game.players.filter((player) => player.team === "B").map((player) => player.player.name).join(" & ");
      return [index + 1, game.status, teamA, teamB, game.scoreA ?? "", game.scoreB ?? "", game.winningTeam ? `Team ${game.winningTeam}` : ""].map(csvCell).join(",");
    }),
  ];

  const filename = `${tournament.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "tournament"}-summary.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(`\uFEFF${lines.join("\r\n")}`);
});

// Operator sets (or edits) the tournament's scheduled window, e.g.
// 4:00 PM - 9:00 PM. Both are optional/independent so the operator can set
// just a start time first and add the end time later.
tournamentsRouter.patch("/:id/schedule", async (req: AuthedRequest, res) => {
  if (!(await canManageTournament(req, req.params.id))) return res.status(403).json({ error: "You can only edit tournaments you own." });
  const { scheduledStart, scheduledEnd } = req.body as {
    scheduledStart?: string | null;
    scheduledEnd?: string | null;
  };
  const tournament = await prisma.tournament.update({
    where: { id: req.params.id },
    data: {
      scheduledStart: scheduledStart === undefined ? undefined : scheduledStart ? new Date(scheduledStart) : null,
      scheduledEnd: scheduledEnd === undefined ? undefined : scheduledEnd ? new Date(scheduledEnd) : null,
    },
  });
  broadcastTournamentUpdate(tournament.id, "tournament:changed");
  res.json(tournament);
});

// Operator extends the cutoff time for players who want to keep playing
// past the scheduled end. Pushes scheduledEnd forward and, if the
// tournament had already been auto-finalized, un-finalizes it and resumes
// as ACTIVE so games can keep being recorded.
tournamentsRouter.post("/:id/extend", async (req: AuthedRequest, res) => {
  if (!(await canManageTournament(req, req.params.id))) return res.status(403).json({ error: "You can only edit tournaments you own." });
  const { newEndTime } = req.body as { newEndTime?: string };
  if (!newEndTime) return res.status(400).json({ error: "newEndTime is required" });
  const tournament = await prisma.tournament.update({
    where: { id: req.params.id },
    data: {
      scheduledEnd: new Date(newEndTime),
      resultsFinalizedAt: null,
      status: "ACTIVE",
    },
  });
  broadcastTournamentUpdate(tournament.id, "tournament:changed");
  res.json(tournament);
});

// Preview-only: computes current standings and flags any podium ties
// (top 3) WITHOUT finalizing anything. The frontend calls this first when
// the operator hits "Finalize now", so it can warn about a tie and offer
// a tiebreaker game or manual ordering before anything is locked in.
tournamentsRouter.get("/:id/finalize/check", async (req, res) => {
  const standings = await computeLeaderboard(req.params.id);
  const ties = detectPodiumTies(standings);
  const unfinishedGames = await countUnfinishedGames(req.params.id);
  res.json({ standings, ties, unfinishedGames });
});

// Operator locks in the official standings right now (e.g. ending early,
// or manually confirming results instead of waiting for the scheduled
// end time to trigger the automatic finalize in index.ts).
//
// Optional `manualOrder`: a full list of player IDs in the exact order
// the operator wants them recorded (used when they've manually resolved
// a podium tie). Any player left out is appended afterward in their
// normally-computed order, so the frontend only needs to reorder the
// tied group and can leave everyone else as-is.
tournamentsRouter.post("/:id/finalize", async (req: AuthedRequest, res) => {
  if (!(await canManageTournament(req, req.params.id))) return res.status(403).json({ error: "You can only finish tournaments you own." });
  const unfinishedGames = await countUnfinishedGames(req.params.id);
  if (unfinishedGames > 0) {
    return res.status(409).json({ error: "Finish or cancel all queued and active games before finalizing.", unfinishedGames });
  }
  const { manualOrder } = req.body as { manualOrder?: string[] };
  let standings = await computeLeaderboard(req.params.id);

  if (manualOrder && manualOrder.length > 0) {
    // manualOrder only lists the tied group being resolved (a contiguous
    // slice of standings, by construction of detectPodiumTies). Splice
    // them back into that same slice, in the operator's chosen order,
    // instead of moving them to the front - everyone else keeps their
    // normally-computed position.
    const idSet = new Set(manualOrder);
    const positions = standings
      .map((r, i) => (idSet.has(r.playerId) ? i : -1))
      .filter((i) => i >= 0);
    const byId = new Map(standings.map((r) => [r.playerId, r]));
    const replacement = manualOrder
      .map((id) => byId.get(id))
      .filter((r): r is LeaderboardRow => !!r);

    if (positions.length === replacement.length && replacement.length > 0) {
      const start = Math.min(...positions);
      const next = [...standings];
      next.splice(start, replacement.length, ...replacement);
      standings = next;
    }
  }

  const tournament = await prisma.tournament.update({
    where: { id: req.params.id },
    data: {
      status: "COMPLETED",
      resultsFinalizedAt: new Date(),
      finalStandings: standings as any,
    },
  });
  broadcastTournamentUpdate(tournament.id, "tournament:changed");
  res.json(tournament);
});

// Creates a one-off game between the given (tied) players to break a
// podium tie flagged by /finalize/check. The tournament is NOT finalized
// by this call - the operator runs the game like any other from Court
// Control, then hits "Finalize now" again once it's finished.
tournamentsRouter.post("/:id/finalize/tiebreak-game", async (req: AuthedRequest, res) => {
  if (!(await canManageTournament(req, req.params.id))) return res.status(403).json({ error: "You can only edit tournaments you own." });
  const { playerIds } = req.body as { playerIds?: string[] };
  if (!playerIds || playerIds.length < 2) {
    return res.status(400).json({ error: "at least 2 playerIds are required" });
  }
  try {
    const game = await createTiebreakGame(req.params.id, playerIds);
    broadcastTournamentUpdate(req.params.id, "games:changed");
    return res.status(201).json(game);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create the tiebreaker game." });
  }
});