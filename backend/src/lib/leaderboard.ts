import { prisma } from "./prisma";

export type LeaderboardRow = {
  playerId: string;
  name: string;
  skillLevel: string;
  wins: number;
  losses: number;
  gamesPlayed: number;
  winPct: number;
};

const UNFINISHED_GAME_STATUSES = ["UPCOMING", "READY", "IN_PROGRESS", "PAUSED"] as const;

export async function countUnfinishedGames(tournamentId: string): Promise<number> {
  return prisma.game.count({
    where: { tournamentId, status: { in: [...UNFINISHED_GAME_STATUSES] } },
  });
}

/**
 * Overall standings for a tournament: every player's wins/losses across all
 * FINISHED games (works for both RANDOM_PAIRING and FIXED_BRACKET, since
 * both produce Game rows with a winningTeam). Shared by the live
 * leaderboard endpoint and the finalize/auto-finalize snapshot below so
 * "current standings" and "final recorded standings" are always computed
 * the same way.
 */
export async function computeLeaderboard(tournamentId: string): Promise<LeaderboardRow[]> {
  const players = await prisma.player.findMany({
    where: { tournamentId, joinStatus: "APPROVED" },
    include: {
      gamePlayers: { include: { game: true } },
    },
  });

  const leaderboard: LeaderboardRow[] = players.map((player) => {
    let wins = 0;
    let losses = 0;
    for (const gp of player.gamePlayers) {
      if (gp.game.status !== "FINISHED" || !gp.game.winningTeam) continue;
      if (gp.game.winningTeam === gp.team) wins++;
      else losses++;
    }
    const gamesPlayed = wins + losses;
    return {
      playerId: player.id,
      name: player.name,
      skillLevel: player.skillLevel,
      wins,
      losses,
      gamesPlayed,
      winPct: gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 1000) / 10 : 0,
    };
  });

  leaderboard.sort((a, b) => b.wins - a.wins || b.winPct - a.winPct || a.losses - b.losses);
  return leaderboard;
}

export type TieGroup = {
  /** 1-based standings position (competition ranking) where this group starts. */
  rank: number;
  rows: LeaderboardRow[];
};

/**
 * Finds groups of players tied on (wins, winPct, losses) whose tie
 * overlaps a podium spot (rank 1-3), using standard competition ranking
 * (players with an identical record share a rank; the next distinct
 * record skips ahead by the group size - e.g. two people tied for 1st
 * means the next player is ranked 3rd, not 2nd).
 *
 * Used by the Finalize flow (routes/tournaments.ts) to warn the operator
 * before locking in results, and to offer a tiebreaker game or manual
 * ordering for exactly the affected players.
 */
export function detectPodiumTies(standings: LeaderboardRow[]): TieGroup[] {
  const groups: TieGroup[] = [];
  let i = 0;
  let rank = 1;
  while (i < standings.length) {
    let j = i + 1;
    while (
      j < standings.length &&
      standings[j].wins === standings[i].wins &&
      standings[j].winPct === standings[i].winPct &&
      standings[j].losses === standings[i].losses
    ) {
      j++;
    }
    const rows = standings.slice(i, j);
    if (rows.length > 1 && rank <= 3) {
      groups.push({ rank, rows });
    }
    rank += rows.length;
    i = j;
  }
  return groups;
}