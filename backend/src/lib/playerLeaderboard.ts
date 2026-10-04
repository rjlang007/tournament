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

export function buildPlayerLeaderboard(accounts: PlayerAccount[]): PlayerLeaderboardRow[] {
  return accounts.map((account) => {
    let openPlayPoints = 0;
    let tournamentPoints = 0;
    let wins = 0;
    let losses = 0;
    let podiums = 0;
    let eventsPlayed = 0;

    for (const profile of account.playerProfiles) {
      let playedEvent = false;
      for (const gamePlayer of profile.gamePlayers) {
        const winningTeam = gamePlayer.game.winningTeam;
        if (!winningTeam) continue;
        playedEvent = true;
        if (winningTeam === gamePlayer.team) wins++;
        else losses++;
      }
      if (playedEvent) eventsPlayed++;

      if (!profile.tournament.resultsFinalizedAt) continue;
      const place = placementInStandings(profile.tournament.finalStandings, profile.id);
      if (place === null || place > 3) continue;
      const points = place === 1 ? 3 : place === 2 ? 2 : 1;
      if (profile.tournament.type === "RANDOM_PAIRING") openPlayPoints += points;
      else tournamentPoints += place === 1 ? 6 : place === 2 ? 3 : 1;
      podiums++;
    }

    const gamesPlayed = wins + losses;
    return {
      userId: account.id,
      username: account.username,
      avatarUrl: account.avatarUrl,
      openPlayPoints,
      tournamentPoints,
      overallPoints: openPlayPoints + tournamentPoints,
      wins,
      losses,
      gamesPlayed,
      winRate: gamesPlayed ? Math.round((wins / gamesPlayed) * 1000) / 10 : 0,
      podiums,
      eventsPlayed,
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

export async function getPlayerLeaderboard(): Promise<PlayerLeaderboardRow[]> {
  const accounts = await prisma.user.findMany({
    where: { role: "PLAYER", playerProfiles: { some: { joinStatus: "APPROVED" } } },
    select: accountSelect,
  });
  return buildPlayerLeaderboard(accounts).sort((a, b) =>
    b.overallPoints - a.overallPoints || b.winRate - a.winRate || b.wins - a.wins || a.username.localeCompare(b.username)
  );
}

export async function getPlayerStats(userId: string): Promise<PlayerLeaderboardRow> {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: accountSelect,
  });
  if (!account) throw new Error("Player account not found.");
  return buildPlayerLeaderboard([account])[0];
}
