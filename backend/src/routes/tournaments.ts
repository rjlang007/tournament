import { Router } from "express";
import { prisma } from "../lib/prisma";
import { computeLeaderboard, countUnfinishedGames, detectPodiumTies, LeaderboardRow } from "../lib/leaderboard";
import { broadcastTournamentUpdate } from "../socket";
import { attachUser, AuthedRequest, canManageTournament } from "../lib/auth";
import { enqueuePlayer } from "../lib/queue";
import { recordAudit } from "../lib/audit";

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

tournamentsRouter.get("/:id/audit", async (req: AuthedRequest, res) => {
  if (!(await canManageTournament(req, req.params.id))) return res.status(403).json({ error: "You can only view audit history for tournaments you own." });
  const logs = await prisma.auditLog.findMany({ where: { tournamentId: req.params.id }, orderBy: { createdAt: "desc" }, take: 500, include: { actor: { select: { username: true } } } });
  res.json(logs);
});

// Repairs orphaned player statuses after a browser/server interruption. It
// does not create games; staff still controls when the repaired queue is drawn.
tournamentsRouter.post("/:id/recover", async (req: AuthedRequest, res) => {
  if (!(await canManageTournament(req, req.params.id))) return res.status(403).json({ error: "You can only repair tournaments you own." });
  const tournament = await prisma.tournament.findUnique({ where: { id: req.params.id }, select: { type: true } });
  if (!tournament) return res.status(404).json({ error: "Tournament not found." });
  const activePlayers = await prisma.gamePlayer.findMany({ where: { game: { tournamentId: req.params.id, status: { in: ["READY", "IN_PROGRESS", "PAUSED"] } } }, select: { playerId: true } });
  const activeIds = new Set(activePlayers.map((player) => player.playerId));
  const stalePlayers = await prisma.player.findMany({ where: { tournamentId: req.params.id, status: { in: ["QUEUED", "PLAYING"] } }, select: { id: true } });
  const repairedIds = stalePlayers.map((player) => player.id).filter((id) => !activeIds.has(id));
  if (repairedIds.length > 0) {
    await prisma.player.updateMany({ where: { id: { in: repairedIds } }, data: { status: "WAITING" } });
    if (tournament.type === "RANDOM_PAIRING") {
      for (const playerId of repairedIds) await enqueuePlayer(req.params.id, playerId);
    }
  }
  await recordAudit(prisma, { tournamentId: req.params.id, actorId: req.userId, action: "TOURNAMENT_RECOVERED", entityType: "Tournament", entityId: req.params.id, details: { repairedPlayerIds: repairedIds } });
  res.json({ repairedPlayers: repairedIds.length, playerIds: repairedIds });
});

tournamentsRouter.post("/:id/emergency-pause", async (req: AuthedRequest, res) => {
  if (!(await canManageTournament(req, req.params.id))) return res.status(403).json({ error: "You can only pause tournaments you own." });
  const now = Date.now();
  const paused = await prisma.$transaction(async (tx) => {
    const games = await tx.game.findMany({ where: { tournamentId: req.params.id, status: "IN_PROGRESS" } });
    for (const game of games) {
      const elapsed = game.startedAt ? Math.floor((now - game.startedAt.getTime()) / 1000) : 0;
      await tx.game.update({ where: { id: game.id }, data: { status: "PAUSED", pausedAt: new Date(now), remainingSeconds: Math.max(0, game.durationSeconds - elapsed) } });
    }
    return games.length;
  });
  await recordAudit(prisma, { tournamentId: req.params.id, actorId: req.userId, action: "EMERGENCY_PAUSED", entityType: "Tournament", entityId: req.params.id, details: { pausedGames: paused } });
  broadcastTournamentUpdate(req.params.id, "games:changed");
  res.json({ pausedGames: paused });
});

tournamentsRouter.post("/:id/emergency-resume", async (req: AuthedRequest, res) => {
  if (!(await canManageTournament(req, req.params.id))) return res.status(403).json({ error: "You can only resume tournaments you own." });
  const games = await prisma.game.findMany({ where: { tournamentId: req.params.id, status: "PAUSED" } });
  const now = Date.now();
  await prisma.$transaction(games.map((game) => prisma.game.update({ where: { id: game.id }, data: { status: "IN_PROGRESS", pausedAt: null, startedAt: new Date(now - Math.max(0, game.durationSeconds - game.remainingSeconds) * 1000) } })));
  await recordAudit(prisma, { tournamentId: req.params.id, actorId: req.userId, action: "EMERGENCY_RESUMED", entityType: "Tournament", entityId: req.params.id, details: { resumedGames: games.length } });
  broadcastTournamentUpdate(req.params.id, "games:changed");
  res.json({ resumedGames: games.length });
});

tournamentsRouter.patch("/:id/location", async (req: AuthedRequest, res) => {
  if (!(await canManageTournament(req, req.params.id))) return res.status(403).json({ error: "You can only edit tournaments you own." });
  const { locationName, locationAddress, latitude, longitude } = req.body as {
    locationName?: string | null;
    locationAddress?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
  const hasLatitude = latitude !== null && latitude !== undefined;
  const hasLongitude = longitude !== null && longitude !== undefined;
  if (hasLatitude !== hasLongitude) {
    return res.status(400).json({ error: "Both map coordinates are required together." });
  }
  const hasCoordinates = hasLatitude && hasLongitude;
  if (hasCoordinates && (typeof latitude !== "number" || typeof longitude !== "number" || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)) {
    return res.status(400).json({ error: "Map coordinates are invalid." });
  }
  const tournament = await prisma.tournament.update({
    where: { id: req.params.id },
    data: {
      locationName: typeof locationName === "string" ? locationName.trim() || null : locationName ?? null,
      locationAddress: typeof locationAddress === "string" ? locationAddress.trim() || null : locationAddress ?? null,
      locationLatitude: hasCoordinates ? latitude : null,
      locationLongitude: hasCoordinates ? longitude : null,
    },
  });
  broadcastTournamentUpdate(tournament.id, "tournament:changed");
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
  const finalized = await prisma.tournament.updateMany({
    where: { id: req.params.id, status: { not: "COMPLETED" }, resultsFinalizedAt: null },
    data: { status: "COMPLETED", resultsFinalizedAt: new Date(), finalStandings: standings as any },
  });
  if (finalized.count !== 1) return res.status(409).json({ error: "Tournament was finalized by another request." });
  const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: req.params.id } });
  await recordAudit(prisma, { tournamentId: tournament.id, actorId: req.userId, action: "TOURNAMENT_FINALIZED", entityType: "Tournament", entityId: tournament.id });
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
    ["Rank", "Placement", "Player", "Skill Level", "Games Played", "Wins", "Losses", "Win %", "Points For", "Points Against", "Loss-game Points", "Point Differential"].map(csvCell).join(","),
    ...standings.map((row, index) => [index + 1, placement(index + 1), row.name, row.skillLevel, row.gamesPlayed, row.wins, row.losses, row.winPct, row.pointsFor, row.pointsAgainst, row.lossPoints, row.pointDiff].map(csvCell).join(",")),
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
  const startDate = scheduledStart ? new Date(scheduledStart) : null;
  const endDate = scheduledEnd ? new Date(scheduledEnd) : null;
  if ((startDate && Number.isNaN(startDate.getTime())) || (endDate && Number.isNaN(endDate.getTime()))) {
    return res.status(400).json({ error: "Schedule times must be valid dates." });
  }
  if (startDate && endDate && endDate <= startDate) {
    return res.status(400).json({ error: "Tournament end time must be after the start time." });
  }
  const tournament = await prisma.tournament.update({
    where: { id: req.params.id },
    data: {
      scheduledStart: scheduledStart === undefined ? undefined : startDate,
      scheduledEnd: scheduledEnd === undefined ? undefined : endDate,
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
  const endDate = new Date(newEndTime);
  if (Number.isNaN(endDate.getTime())) return res.status(400).json({ error: "newEndTime must be a valid date." });
  const tournament = await prisma.tournament.update({
    where: { id: req.params.id },
    data: {
      scheduledEnd: endDate,
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
tournamentsRouter.post("/:id/finalize", async (req: AuthedRequest, res) => {
  if (!(await canManageTournament(req, req.params.id))) return res.status(403).json({ error: "You can only finish tournaments you own." });
  const unfinishedGames = await countUnfinishedGames(req.params.id);
  if (unfinishedGames > 0) {
    return res.status(409).json({ error: "Finish or cancel all queued and active games before finalizing.", unfinishedGames });
  }
  const standings = await computeLeaderboard(req.params.id);

  const finalized = await prisma.tournament.updateMany({
    where: { id: req.params.id, status: { not: "COMPLETED" }, resultsFinalizedAt: null },
    data: {
      status: "COMPLETED",
      resultsFinalizedAt: new Date(),
      finalStandings: standings as any,
    },
  });
  if (finalized.count !== 1) return res.status(409).json({ error: "Tournament was finalized by another request." });
  const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: req.params.id } });
  await recordAudit(prisma, { tournamentId: tournament.id, actorId: req.userId, action: "TOURNAMENT_FINALIZED", entityType: "Tournament", entityId: tournament.id });
  broadcastTournamentUpdate(tournament.id, "tournament:changed");
  res.json(tournament);
});
