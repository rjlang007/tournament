import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type PlayerLeaderboardRow = {
  userId: string;
  username: string;
  avatarUrl: string | null;
  openPlayPoints: number;
  tournamentPoints: number;
  overallPoints: number;
  wins: number;
  losses: number;
  gamesPlayed: number;
  winRate: number;
  podiums: number;
  eventsPlayed: number;
  championships: number;
  rankTier: string;
  badges: string[];
};

export type PlayerAccount = Prisma.UserGetPayload<{
  select: {
    id: true;
    username: true;
    avatarUrl: true;
    playerProfiles: {
      where: { joinStatus: "APPROVED" };
      select: {
        id: true;
        tournament: { select: { type: true; finalStandings: true; resultsFinalizedAt: true } };
        gamePlayers: {
          where: { game: { status: "FINISHED" } };
          select: { team: true; game: { select: { winningTeam: true } } };
        };
      };
    };
  };
}>;

function placementInStandings(standings: Prisma.JsonValue, playerId: string): number | null {
  if (!Array.isArray(standings)) return null;
  const index = standings.findIndex((row) =>
    row !== null && typeof row === "object" && !Array.isArray(row) &&
    "playerId" in row && row.playerId === playerId
  );
  return index >= 0 ? index + 1 : null;
}

export function buildPlayerLeaderboard(accounts: PlayerAccount[], season?: number): PlayerLeaderboardRow[] {
  return accounts.map((account) => {
    let openPlayPoints = 0;
    let tournamentPoints = 0;
    let wins = 0;
    let losses = 0;
    let podiums = 0;
    let eventsPlayed = 0;
    let championships = 0;

    for (const profile of account.playerProfiles) {
      const finalizedAt = profile.tournament.resultsFinalizedAt;
      if (season !== undefined && (!finalizedAt || finalizedAt.getFullYear() !== season)) continue;

      let playedEvent = false;
      for (const gamePlayer of profile.gamePlayers) {
        const winningTeam = gamePlayer.game.winningTeam;
        if (!winningTeam) continue;
        playedEvent = true;
        if (winningTeam === gamePlayer.team) wins++;
        else losses++;
      }
      if (playedEvent) eventsPlayed++;

      if (!finalizedAt) continue;
      const place = placementInStandings(profile.tournament.finalStandings, profile.id);
      if (place === null || place > 3) continue;
      const points = place === 1 ? 3 : place === 2 ? 2 : 1;
      if (profile.tournament.type === "RANDOM_PAIRING") openPlayPoints += points;
      else tournamentPoints += place === 1 ? 6 : place === 2 ? 3 : 1;
      podiums++;
      if (place === 1) championships++;
    }

    const gamesPlayed = wins + losses;
    const overallPoints = openPlayPoints + tournamentPoints;
    const rankTier = overallPoints >= 100 ? "Legend" : overallPoints >= 50 ? "Elite" : overallPoints >= 25 ? "Challenger" : overallPoints >= 10 ? "Contender" : "Rookie";
    const badges = [
      ...(championships > 0 ? ["Champion"] : []),
      ...(podiums >= 5 ? ["Podium regular"] : podiums > 0 ? ["First podium"] : []),
      ...(wins >= 10 ? ["Match winner"] : []),
      ...(gamesPlayed >= 20 && wins / gamesPlayed >= 0.75 ? ["Win-rate ace"] : []),
    ];
    return {
      userId: account.id,
      username: account.username,
      avatarUrl: account.avatarUrl,
      openPlayPoints,
      tournamentPoints,
      overallPoints,
      wins,
      losses,
      gamesPlayed,
      winRate: gamesPlayed ? Math.round((wins / gamesPlayed) * 1000) / 10 : 0,
      podiums,
      eventsPlayed,
      championships,
      rankTier,
      badges,
    };
  });
}

const accountSelect = {
  id: true,
  username: true,
  avatarUrl: true,
  playerProfiles: {
    where: { joinStatus: "APPROVED" as const },
    select: {
      id: true,
      tournament: { select: { type: true, finalStandings: true, resultsFinalizedAt: true } },
      gamePlayers: {
        where: { game: { status: "FINISHED" as const } },
        select: { team: true, game: { select: { winningTeam: true } } },
      },
    },
  },
};

export async function getPlayerLeaderboard(season?: number): Promise<PlayerLeaderboardRow[]> {
  const accounts = await prisma.user.findMany({
    where: { role: "PLAYER", playerProfiles: { some: { joinStatus: "APPROVED" } } },
    select: accountSelect,
  });
  return buildPlayerLeaderboard(accounts, season).sort((a, b) =>
    b.overallPoints - a.overallPoints || b.winRate - a.winRate || b.wins - a.wins || a.username.localeCompare(b.username)
  );
}

export async function getLeaderboardSeasons(): Promise<number[]> {
  const tournaments = await prisma.tournament.findMany({
    where: { resultsFinalizedAt: { not: null } },
    select: { resultsFinalizedAt: true },
  });
  return [...new Set(tournaments.flatMap(({ resultsFinalizedAt }) => resultsFinalizedAt ? [resultsFinalizedAt.getFullYear()] : []))]
    .sort((a, b) => b - a);
}

export async function getPlayerStats(userId: string): Promise<PlayerLeaderboardRow> {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: accountSelect,
  });
  if (!account) throw new Error("Player account not found.");
  return buildPlayerLeaderboard([account])[0];
}

export type PlayerMatchHistory = {
  id: string;
  tournamentName: string;
  tournamentType: "RANDOM_PAIRING" | "FIXED_BRACKET";
  playedAt: Date;
  result: "WIN" | "LOSS";
  ownScore: number | null;
  opponentScore: number | null;
  teammates: string[];
  opponents: string[];
};

export async function getPlayerMatchHistory(userId: string): Promise<PlayerMatchHistory[]> {
  const games = await prisma.game.findMany({
    where: {
      status: "FINISHED",
      players: { some: { player: { userId, joinStatus: "APPROVED" } } },
    },
    orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      finishedAt: true,
      createdAt: true,
      scoreA: true,
      scoreB: true,
      winningTeam: true,
      tournament: { select: { name: true, type: true } },
      players: {
        select: {
          team: true,
          player: { select: { userId: true, joinStatus: true, name: true } },
        },
      },
    },
  });

  return games.flatMap((game) => {
    const ownEntry = game.players.find(({ player }) => player.userId === userId && player.joinStatus === "APPROVED");
    if (!ownEntry || !game.winningTeam) return [];
    const ownScore = ownEntry.team === "A" ? game.scoreA : game.scoreB;
    const opponentScore = ownEntry.team === "A" ? game.scoreB : game.scoreA;
    return [{
      id: game.id,
      tournamentName: game.tournament.name,
      tournamentType: game.tournament.type,
      playedAt: game.finishedAt ?? game.createdAt,
      result: ownEntry.team === game.winningTeam ? "WIN" as const : "LOSS" as const,
      ownScore,
      opponentScore,
      teammates: game.players
        .filter(({ team, player }) => team === ownEntry.team && player.userId !== userId)
        .map(({ player }) => player.name),
      opponents: game.players.filter(({ team }) => team !== ownEntry.team).map(({ player }) => player.name),
    }];
  });
}
