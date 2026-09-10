import { SkillLevel } from "@prisma/client";

export type QueuedPlayer = {
  id: string;
  name: string;
  skillLevel: SkillLevel;
  gamesPlayed: number;
  arrivalAt: number;
  queuedAt: number;
  wins: number;
  losses: number;
  recentPartnerIds: Set<string>;
  recentOpponentIds: Set<string>;
};

export type ProposedPairing = {
  playerA: QueuedPlayer;
  playerB: QueuedPlayer;
};

/** Skill combinations that can form a doubles team. */
export function isEligiblePair(a: SkillLevel, b: SkillLevel): boolean {
  const pair = [a, b].sort().join("-");
  const allowed = new Set([
    "ADVANCE-AVERAGE",
    "ADVANCE-BEGINNER",
    "AVERAGE-AVERAGE",
    "AVERAGE-BEGINNER",
    "BEGINNER-BEGINNER",
  ]);
  return allowed.has(pair);
}

type TeamSkillPair = readonly [SkillLevel, SkillLevel];

function teamSkillPairKey(team: TeamSkillPair): string {
  return team.slice().sort().join("-");
}

/**
 * A valid teammate pair is not automatically a fair opponent pair. Keep the
 * allowed doubles matchups explicit so a close numeric score cannot create a
 * lopsided skill composition. In particular, Beginner-Beginner never faces
 * Beginner-Advance or Beginner-Average, and Average-Beginner never faces
 * Average-Average or Average-Advance.
 */
export function isEligibleTeamMatchup(teamA: TeamSkillPair, teamB: TeamSkillPair): boolean {
  const matchup = [teamSkillPairKey(teamA), teamSkillPairKey(teamB)].sort().join("|");
  return new Set([
    "ADVANCE-AVERAGE|ADVANCE-AVERAGE",
    "ADVANCE-BEGINNER|ADVANCE-BEGINNER",
    "ADVANCE-BEGINNER|AVERAGE-AVERAGE",
    "AVERAGE-AVERAGE|AVERAGE-AVERAGE",
    "AVERAGE-BEGINNER|AVERAGE-BEGINNER",
    "BEGINNER-BEGINNER|BEGINNER-BEGINNER",
  ]).has(matchup);
}

/** Numeric skill score used only to compare overall TEAM strength (not for pairing eligibility). */
const SKILL_SCORE: Record<SkillLevel, number> = {
  BEGINNER: 1,
  AVERAGE: 2,
  ADVANCE: 3,
};

function pairScore(pair: ProposedPairing): number {
  return SKILL_SCORE[pair.playerA.skillLevel] + SKILL_SCORE[pair.playerB.skillLevel];
}

/** Fisher-Yates shuffle - this is the "bunot-bunot" / spin-the-wheel draw. */
export function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Greedily builds as many eligible 1v1 individual pairings as possible from
 * a shuffled pool. Returns the pairings plus whoever couldn't be matched
 * this round (e.g. an odd Advance-heavy pool with no Beginners left).
 *
 * This produces the two INDIVIDUAL opponents. To build a doubles game
 * (2v2), call this twice more to pick each side's partner, or use
 * buildDoublesGame() below which composes a balanced 4-player game.
 */
export function drawEligiblePairs(pool: QueuedPlayer[]): {
  pairs: ProposedPairing[];
  leftover: QueuedPlayer[];
} {
  const shuffled = shuffle(pool);
  const used = new Set<string>();
  const pairs: ProposedPairing[] = [];

  for (let i = 0; i < shuffled.length; i++) {
    const a = shuffled[i];
    if (used.has(a.id)) continue;
    for (let j = i + 1; j < shuffled.length; j++) {
      const b = shuffled[j];
      if (used.has(b.id)) continue;
      if (isEligiblePair(a.skillLevel, b.skillLevel)) {
        pairs.push({ playerA: a, playerB: b });
        used.add(a.id);
        used.add(b.id);
        break;
      }
    }
  }

  const leftover = shuffled.filter((p) => !used.has(p.id));
  return { pairs, leftover };
}

export type DoublesGame = {
  teamA: [QueuedPlayer, QueuedPlayer];
  teamB: [QueuedPlayer, QueuedPlayer];
};

export type MatchmakingOptions = {
  finalPhase?: boolean;
  leaderIds?: Set<string>;
};

/**
 * Builds one 2v2 doubles game out of a pool: draws two eligible partner
 * pairs first (each pair is a valid teammate combo under the skill rule),
 * then matches up the two PAIRS whose combined skill score is closest,
 * so Team A and Team B are an even matchup overall - not just a rule that
 * each individual pair is internally eligible (a random draw could
 * otherwise put e.g. two Advance-anchored pairs against two
 * Average-Beginner pairs, which is a lopsided game even though every
 * individual pairing was "legal"). Ties are broken randomly, and which
 * matched pair becomes "Team A" vs "Team B" is a coin flip.
 *
 * Returns null if the pool doesn't contain two eligible partner-pairs.
 */
export function buildDoublesGame(pool: QueuedPlayer[], options: MatchmakingOptions = {}): {
  game: DoublesGame | null;
  leftover: QueuedPlayer[];
} {
  if (pool.length < 4) {
    return { game: null, leftover: pool };
  }
  const shuffled = shuffle(pool);
  const candidates: Array<{
    teamA: [QueuedPlayer, QueuedPlayer];
    teamB: [QueuedPlayer, QueuedPlayer];
    diff: number;
    maxPace: number;
    totalPace: number;
    queuedAt: number;
    leaderCount: number;
    repeatPenalty: number;
  }> = [];
  const now = Date.now();
  const gamesPerHour = 4;
  const pace = (player: QueuedPlayer) => {
    const hoursAvailable = Math.max(1 / gamesPerHour, (now - player.arrivalAt) / 3_600_000);
    return player.gamesPlayed / hoursAvailable;
  };

  // Evaluate complete four-player games instead of committing to the first
  // legal pair found. This avoids a greedy pairing leaving an unbalanced game
  // or making a valid four-player lineup impossible later in the queue.
  for (let a = 0; a < shuffled.length; a++) {
    for (let b = a + 1; b < shuffled.length; b++) {
      if (!isEligiblePair(shuffled[a].skillLevel, shuffled[b].skillLevel)) continue;
      for (let c = 0; c < shuffled.length; c++) {
        if (c === a || c === b) continue;
        for (let d = c + 1; d < shuffled.length; d++) {
          if (d === a || d === b || !isEligiblePair(shuffled[c].skillLevel, shuffled[d].skillLevel)) continue;
          const teamA: [QueuedPlayer, QueuedPlayer] = [shuffled[a], shuffled[b]];
          const teamB: [QueuedPlayer, QueuedPlayer] = [shuffled[c], shuffled[d]];
            if (!isEligibleTeamMatchup(
              [teamA[0].skillLevel, teamA[1].skillLevel],
              [teamB[0].skillLevel, teamB[1].skillLevel]
            )) continue;
          const selected = [...teamA, ...teamB];
          const teamPairs: Array<[QueuedPlayer, QueuedPlayer]> = [teamA, teamB];
          const repeatPenalty = selected.reduce((penalty, player, index) => {
            const teammate = teamPairs[Math.floor(index / 2)][index % 2 === 0 ? 1 : 0];
            const opponents = teamPairs[1 - Math.floor(index / 2)];
            return penalty
              + (player.recentPartnerIds.has(teammate.id) ? 4 : 0)
              + opponents.reduce((opponentPenalty, opponent) => opponentPenalty + (player.recentOpponentIds.has(opponent.id) ? 1 : 0), 0);
          }, 0);
          candidates.push({
            teamA,
            teamB,
            diff: Math.abs(pairScore({ playerA: teamA[0], playerB: teamA[1] }) - pairScore({ playerA: teamB[0], playerB: teamB[1] })),
            maxPace: Math.max(...selected.map(pace)),
            totalPace: selected.reduce((sum, player) => sum + pace(player), 0),
            queuedAt: Math.min(...selected.map((player) => player.queuedAt)),
            leaderCount: options.leaderIds ? selected.filter((player) => options.leaderIds?.has(player.id)).length : 0,
            repeatPenalty,
          });
        }
      }
    }
  }

  if (candidates.length === 0) return { game: null, leftover: pool };
  const leaderCandidates = options.finalPhase && options.leaderIds && pool.some((player) => options.leaderIds?.has(player.id))
    ? candidates.filter((candidate) => candidate.leaderCount === 1)
    : candidates;
  const eligibleCandidates = leaderCandidates.length > 0 ? leaderCandidates : candidates;
  const bestRepeatPenalty = Math.min(...eligibleCandidates.map((candidate) => candidate.repeatPenalty));
  const freshCandidates = eligibleCandidates.filter((candidate) => candidate.repeatPenalty === bestRepeatPenalty);
  const bestMaxPace = Math.min(...freshCandidates.map((candidate) => candidate.maxPace));
  const fairnessCandidates = freshCandidates.filter((candidate) => candidate.maxPace === bestMaxPace);
  const bestTotalPace = Math.min(...fairnessCandidates.map((candidate) => candidate.totalPace));
  const balancedCandidates = fairnessCandidates.filter((candidate) => candidate.totalPace === bestTotalPace);
  const bestDiff = Math.min(...balancedCandidates.map((candidate) => candidate.diff));
  const skillBalancedCandidates = balancedCandidates.filter((candidate) => candidate.diff === bestDiff);
  const earliestQueueTime = Math.min(...skillBalancedCandidates.map((candidate) => candidate.queuedAt));
  const fairCandidates = skillBalancedCandidates.filter((candidate) => candidate.queuedAt === earliestQueueTime);
  const best = shuffle(fairCandidates)[0];
  const [teamPairA, teamPairB] = shuffle([best.teamA, best.teamB]);
  const remaining = pool.filter(
    (p) =>
      ![
        teamPairA[0].id,
        teamPairA[1].id,
        teamPairB[0].id,
        teamPairB[1].id,
      ].includes(p.id)
  );
  return {
    game: {
      teamA: teamPairA,
      teamB: teamPairB,
    },
    leftover: remaining,
  };
}

/**
 * Fills as many doubles games as the number of available (enabled, free)
 * courts / upcoming slots allows, from a waiting pool. Used both for
 * "next 4-6 games" preview and for actually assigning players to a court.
 */
export function buildQueueBatch(
  pool: QueuedPlayer[],
  maxGames: number,
  options: MatchmakingOptions = {}
): { games: DoublesGame[]; leftover: QueuedPlayer[] } {
  let remainingPool = [...pool];
  const games: DoublesGame[] = [];

  while (games.length < maxGames) {
    const { game, leftover } = buildDoublesGame(remainingPool, options);
    if (!game) break;
    games.push(game);
    remainingPool = leftover;
  }

  return { games, leftover: remainingPool };
}