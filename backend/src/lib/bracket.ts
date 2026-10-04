import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { shuffle } from "./matchmaking";

type DatabaseClient = typeof prisma | Prisma.TransactionClient;

export type BracketFormat = "SINGLE_ELIMINATION" | "DOUBLE_ELIMINATION" | "ROUND_ROBIN";

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

type ByeMatch = {
  id: string;
  bracketSide: string;
  label: string | null;
  entryAId: string | null;
  entryBId: string | null;
  winnerEntryId: string | null;
  nextMatchId: string | null;
  nextSlot: string | null;
  loserNextMatchId: string | null;
  loserNextSlot: string | null;
};

export function canAdvanceBye(match: ByeMatch, matches: ByeMatch[]) {
  if (!(["WINNERS", "LOSERS"].includes(match.bracketSide)) || match.winnerEntryId) return false;
  if (match.label?.endsWith(" (BYE)")) return false;
  const filledSlots = [match.entryAId, match.entryBId].filter(Boolean).length;
  if (filledSlots > 1) return false;

  const missingSlots = filledSlots === 0 ? ["A", "B"] : [match.entryAId ? "B" : "A"];
  const incomingMatches = matches.filter((source) =>
    (source.nextMatchId === match.id && missingSlots.includes(source.nextSlot ?? "")) ||
    (source.loserNextMatchId === match.id && missingSlots.includes(source.loserNextSlot ?? ""))
  );
  const incomingPathsResolved = incomingMatches.every((source) =>
    Boolean(source.winnerEntryId) || Boolean(source.label?.endsWith(" (BYE)"))
  );
  if (!incomingPathsResolved) return false;
  return filledSlots === 1 || (filledSlots === 0 && incomingMatches.length > 0);
}

/**
 * Looks up a player in this tournament by name (case-insensitive), or
 * creates a new one on the fly. This is what powers "type a name into a
 * bracket slot" in the UI - if it matches an existing registrant they get
 * used, otherwise a new player row is created for them.
 */
export async function resolveOrCreatePlayerByName(tournamentId: string, rawName: string) {
  const name = rawName.trim();
  if (!name) throw new Error("Name is required.");
  const existing = await prisma.player.findFirst({
    where: { tournamentId, name: { equals: name, mode: "insensitive" } },
  });
  if (existing) return existing;
  return prisma.player.create({ data: { tournamentId, name, skillLevel: "AVERAGE" } });
}

/**
 * Creates the empty shell of a bracket sized for `participantCount`
 * players/teams, BEFORE anyone has been assigned to a slot. The operator
 * fills slots afterwards by dragging a name in from the roster or typing
 * one (see fillBracketSlot below).
 *
 * - SINGLE_ELIMINATION: one set of empty round-1..final matches.
 * - DOUBLE_ELIMINATION: the same winners bracket, plus a fully pre-wired
 *   losers bracket and a grand final. Simplification: no "bracket reset" -
 *   if the losers-bracket finalist beats the winners-bracket champion in
 *   the grand final, that single game decides the title rather than
 *   forcing a second one. This matches how a lot of local/club double-elim
 *   brackets are actually run.
 *
 * ROUND_ROBIN doesn't use a slot-tree shell at all - see generateRoundRobin.
 */
export async function createBracketShell(bracketId: string, participantCount: number, format: BracketFormat) {
  if (format === "ROUND_ROBIN") {
    throw new Error("Round Robin doesn't use a bracket shell - add participants and generate the schedule instead.");
  }
  if (participantCount < 2) {
    throw new Error("Need at least 2 players/teams to build a bracket.");
  }

  await prisma.bracket.update({ where: { id: bracketId }, data: { format } });
  // Wipe any previous shell so re-generating (e.g. after changing the
  // player count) is safe and idempotent.
  await prisma.bracketMatch.deleteMany({ where: { bracketId } });

  const size = nextPowerOfTwo(participantCount);
  const totalRounds = Math.log2(size);

  const winnersRounds: string[][] = [];
  for (let round = 1; round <= totalRounds; round++) {
    const matchesInRound = size / Math.pow(2, round);
    const roundIds: string[] = [];
    for (let slot = 0; slot < matchesInRound; slot++) {
      const isFinal = round === totalRounds;
      const match = await prisma.bracketMatch.create({
        data: {
          bracketId,
          round,
          slot,
          bracketSide: "WINNERS",
          label: isFinal
            ? format === "DOUBLE_ELIMINATION" && totalRounds > 1 ? "Winners Final" : "Final"
            : `Round ${round}`,
        },
      });
      roundIds.push(match.id);
    }
    winnersRounds.push(roundIds);
  }

  // Wire winners-bracket advancement: match i in round R feeds match
  // floor(i/2) in round R+1, alternating slot A/B.
  for (let round = 0; round < winnersRounds.length - 1; round++) {
    const current = winnersRounds[round];
    const next = winnersRounds[round + 1];
    for (let i = 0; i < current.length; i++) {
      await prisma.bracketMatch.update({
        where: { id: current[i] },
        data: { nextMatchId: next[Math.floor(i / 2)], nextSlot: i % 2 === 0 ? "A" : "B" },
      });
    }
  }

  if (format === "DOUBLE_ELIMINATION" && totalRounds >= 2) {
    await buildLosersBracketAndGrandFinal(bracketId, winnersRounds, totalRounds);
  }

  return prisma.bracketMatch.findMany({
    where: { bracketId },
    orderBy: [{ bracketSide: "asc" }, { round: "asc" }, { slot: "asc" }],
  });
}

/**
 * Builds the losers bracket for double-elimination and wires it to the
 * winners bracket, using the standard construction: losers rounds
 * alternate between "minor" rounds (previous losers-round winners play
 * each other) and "major/drop" rounds (previous losers-round winners play
 * the newest batch of winners-bracket losers), halving every other round
 * until one match remains (the losers final). That winner meets the
 * winners-bracket champion in the grand final.
 */
async function buildLosersBracketAndGrandFinal(bracketId: string, winnersRounds: string[][], totalRounds: number) {
  const size = winnersRounds[0].length * 2;
  const losersRoundCount = 2 * (totalRounds - 1);
  const losersRounds: string[][] = [];

  for (let k = 1; k <= losersRoundCount; k++) {
    const isDrop = k % 2 === 0;
    const prevCount = k === 1 ? size / 2 : losersRounds[k - 2].length;
    const matchesInRound = isDrop ? prevCount : Math.ceil(prevCount / 2);
    const isFinal = k === losersRoundCount;
    const roundIds: string[] = [];
    for (let slot = 0; slot < matchesInRound; slot++) {
      const match = await prisma.bracketMatch.create({
        data: {
          bracketId,
          round: k,
          slot,
          bracketSide: "LOSERS",
          label: isFinal ? "Losers Final" : `Losers Round ${k}`,
        },
      });
      roundIds.push(match.id);
    }
    losersRounds.push(roundIds);
  }

  // Winners-round-1 losers drop into losers round 1 (minor round), two per match.
  for (let i = 0; i < winnersRounds[0].length; i++) {
    await prisma.bracketMatch.update({
      where: { id: winnersRounds[0][i] },
      data: { loserNextMatchId: losersRounds[0][Math.floor(i / 2)], loserNextSlot: i % 2 === 0 ? "A" : "B" },
    });
  }

  // Winners rounds 2..N losers each drop into the corresponding "drop" round,
  // always filling slot B (slot A is reserved for the losers-bracket winner
  // advancing internally into that same match).
  for (let r = 2; r <= totalRounds; r++) {
    const dropRoundIndex = 2 * (r - 1) - 1;
    const dropRound = losersRounds[dropRoundIndex];
    for (let i = 0; i < winnersRounds[r - 1].length; i++) {
      await prisma.bracketMatch.update({
        where: { id: winnersRounds[r - 1][i] },
        data: { loserNextMatchId: dropRound[i], loserNextSlot: "B" },
      });
    }
  }

  // Wire losers-bracket internal advancement.
  for (let k = 0; k < losersRounds.length - 1; k++) {
    const current = losersRounds[k];
    const next = losersRounds[k + 1];
    const nextRoundIsDrop = (k + 2) % 2 === 0; // 1-based round number of `next`
    for (let i = 0; i < current.length; i++) {
      const nextIndex = nextRoundIsDrop ? i : Math.floor(i / 2);
      const nextSlot = nextRoundIsDrop ? "A" : i % 2 === 0 ? "A" : "B";
      await prisma.bracketMatch.update({
        where: { id: current[i] },
        data: { nextMatchId: next[nextIndex], nextSlot },
      });
    }
  }

  // Grand final: winners-bracket champion in slot A, losers-bracket
  // champion in slot B.
  const gf = await prisma.bracketMatch.create({
    data: { bracketId, round: totalRounds + 1, slot: 0, bracketSide: "GRAND_FINAL", label: "Grand Final" },
  });
  const winnersFinal = winnersRounds[winnersRounds.length - 1][0];
  const losersFinal = losersRounds[losersRounds.length - 1][0];
  await prisma.bracketMatch.update({ where: { id: winnersFinal }, data: { nextMatchId: gf.id, nextSlot: "A" } });
  await prisma.bracketMatch.update({ where: { id: losersFinal }, data: { nextMatchId: gf.id, nextSlot: "B" } });
}

/**
 * Fills one slot (A or B) of an empty bracket match with a player, creating
 * the BracketEntry for them. This is what a drag-drop or typed-name fill
 * calls. `playerBId`/`teamName` let a doubles partner be attached in the
 * same call if the UI collects both at once; otherwise a partner can be
 * added afterwards via the existing entry-substitute endpoint.
 */
export async function fillBracketSlot(
  matchId: string,
  slot: "A" | "B",
  playerId: string,
  opts?: { playerBId?: string; teamName?: string }
) {
  const match = await prisma.bracketMatch.findUniqueOrThrow({ where: { id: matchId } });
  const entry = await prisma.bracketEntry.create({
    data: {
      bracketId: match.bracketId,
      playerAId: playerId,
      playerBId: opts?.playerBId,
      teamName: opts?.teamName,
    },
  });
  await prisma.bracketMatch.update({
    where: { id: matchId },
    data: slot === "A" ? { entryAId: entry.id } : { entryBId: entry.id },
  });
  return entry;
}

/** Clears a slot back to empty (does not delete the BracketEntry row). */
export async function clearBracketSlot(matchId: string, slot: "A" | "B") {
  return prisma.bracketMatch.update({
    where: { id: matchId },
    data: slot === "A" ? { entryAId: null } : { entryBId: null },
  });
}

/**
 * Advances any decided byes on both sides of the bracket. A match with one
 * entry advances only after every match that could feed its open slot is
 * resolved, preventing premature advancement in the losers bracket.
 */
export async function lockByes(bracketId: string, db: DatabaseClient = prisma) {
  let advanced = true;
  while (advanced) {
    advanced = false;
    const matches = await db.bracketMatch.findMany({ where: { bracketId } });
    for (const match of matches) {
      if (!canAdvanceBye(match, matches)) continue;
      const winnerId = match.entryAId ?? match.entryBId;
      if (!winnerId) continue;
      await db.bracketMatch.update({
        where: { id: match.id },
        data: { winnerEntryId: winnerId, label: `${match.label ?? "Match"} (BYE)` },
      });
      if (winnerId && match.nextMatchId && match.nextSlot) {
        await db.bracketMatch.update({
          where: { id: match.nextMatchId },
          data: { [match.nextSlot === "A" ? "entryAId" : "entryBId"]: winnerId },
        });
      }
      advanced = true;
    }
  }
  return db.bracketMatch.findMany({
    where: { bracketId },
    orderBy: [{ bracketSide: "asc" }, { round: "asc" }, { slot: "asc" }],
  });
}

/**
 * Records the result of a finished bracket match: advances the winner into
 * its next slot, and (double-elimination only) drops the loser into the
 * losers bracket if this match has a loserNextMatchId wired up.
 */
export async function recordBracketResult(matchId: string, winningEntryId: string, losingEntryId: string | null, db: DatabaseClient = prisma) {
  const match = await db.bracketMatch.findUniqueOrThrow({ where: { id: matchId } });
  await db.bracketMatch.update({ where: { id: matchId }, data: { winnerEntryId: winningEntryId } });

  if (match.nextMatchId && match.nextSlot) {
    await db.bracketMatch.update({
      where: { id: match.nextMatchId },
      data: { [match.nextSlot === "A" ? "entryAId" : "entryBId"]: winningEntryId },
    });
  }
  if (match.loserNextMatchId && match.loserNextSlot && losingEntryId) {
    await db.bracketMatch.update({
      where: { id: match.loserNextMatchId },
      data: { [match.loserNextSlot === "A" ? "entryAId" : "entryBId"]: losingEntryId },
    });
  }
  await lockByes(match.bracketId, db);
}

/**
 * Legacy/alternate entry point: build the bracket from BracketEntry rows
 * that were already registered (e.g. pre-formed doubles pairs added via
 * "+ Add fixed pair"), instead of filling empty slots one at a time.
 * Shuffles for random seeding, then reuses createBracketShell + lockByes.
 */
export async function generateFromExistingEntries(bracketId: string) {
  const bracket = await prisma.bracket.findUniqueOrThrow({ where: { id: bracketId } });
  const entries = await prisma.bracketEntry.findMany({ where: { bracketId } });
  if (entries.length < 2) throw new Error("Need at least 2 fixed pairs to generate a bracket.");
  if (bracket.format === "ROUND_ROBIN") {
    return generateRoundRobin(bracketId, entries.map((e) => e.id));
  }

  const shuffled = shuffle(entries);
  await createBracketShell(bracketId, shuffled.length, bracket.format);
  const round1 = await prisma.bracketMatch.findMany({
    where: { bracketId, bracketSide: "WINNERS", round: 1 },
    orderBy: { slot: "asc" },
  });
  for (let i = 0; i < round1.length; i++) {
    const a = shuffled[i * 2];
    const b = shuffled[i * 2 + 1];
    await prisma.bracketMatch.update({
      where: { id: round1[i].id },
      data: { entryAId: a ? a.id : null, entryBId: b ? b.id : null },
    });
  }
  return lockByes(bracketId);
}

/**
 * Substitutes a player into a bracket entry (e.g. a teammate went home, or
 * a doubles partner is being attached after the primary player was
 * drag/typed into a slot). Only swaps the roster - does not touch bracket
 * position or match history.
 */
export async function substituteBracketPlayer(entryId: string, slot: "A" | "B", newPlayerId: string) {
  return prisma.$transaction(async (tx) => {
    const entry = await tx.bracketEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { bracket: true },
    });
    const previousPlayerId = slot === "A" ? entry.playerAId : entry.playerBId;
    if (previousPlayerId === newPlayerId) return { kind: "unchanged" as const };
    const previousPlayer = previousPlayerId
      ? await tx.player.findUnique({ where: { id: previousPlayerId }, select: { id: true, name: true } })
      : null;

    const replacement = await tx.player.findFirst({
      where: { id: newPlayerId, tournamentId: entry.bracket.tournamentId, status: { not: "LEFT" } },
      select: { id: true, name: true },
    });
    if (!replacement) return { kind: "player-not-found" as const };

    const referencedMatches = await tx.bracketMatch.findMany({
      where: { bracketId: entry.bracketId, OR: [{ entryAId: entry.id }, { entryBId: entry.id }] },
      include: { game: { select: { id: true, status: true } } },
    });
    const futureMatches = referencedMatches.filter((match) => !["FINISHED", "IN_PROGRESS", "PAUSED"].includes(match.game?.status ?? ""));
    if (futureMatches.length === 0) return { kind: "no-future-matches" as const };

    const updatedEntry = await tx.bracketEntry.create({
      data: {
        bracketId: entry.bracketId,
        seed: entry.seed,
        teamName: entry.teamName,
        playerAId: slot === "A" ? newPlayerId : entry.playerAId,
        playerBId: slot === "B" ? newPlayerId : entry.playerBId,
      },
    });

    for (const match of futureMatches) {
      const matchUpdate: { entryAId?: string; entryBId?: string; winnerEntryId?: string | null } = {};
      if (match.entryAId === entry.id) matchUpdate.entryAId = updatedEntry.id;
      if (match.entryBId === entry.id) matchUpdate.entryBId = updatedEntry.id;
      if (match.winnerEntryId === entry.id) matchUpdate.winnerEntryId = updatedEntry.id;
      await tx.bracketMatch.update({ where: { id: match.id }, data: matchUpdate });

      if (match.game) {
        const replacementAlreadyInGame = await tx.gamePlayer.findFirst({ where: { gameId: match.game.id, playerId: newPlayerId } });
        if (previousPlayer) {
          const oldGamePlayer = await tx.gamePlayer.findFirst({ where: { gameId: match.game.id, playerId: previousPlayer.id } });
          if (oldGamePlayer && replacementAlreadyInGame) {
            await tx.gamePlayer.delete({ where: { id: oldGamePlayer.id } });
          } else if (oldGamePlayer) {
            await tx.gamePlayer.update({ where: { id: oldGamePlayer.id }, data: { playerId: newPlayerId } });
          }
        } else if (!replacementAlreadyInGame) {
          await tx.gamePlayer.create({
            data: { gameId: match.game.id, playerId: newPlayerId, team: match.entryAId === entry.id ? "A" : "B" },
          });
        }
      }
    }

    return {
      kind: "updated" as const,
      entry: updatedEntry,
      previousPlayerId: previousPlayer?.id ?? null,
      previousPlayerName: previousPlayer?.name ?? null,
      playerName: replacement.name,
      affectedMatches: futureMatches.length,
    };
  });
}

/**
 * Round Robin: every entry plays every other entry once, via the standard
 * "circle method" scheduling algorithm (one entry fixed, the rest rotate
 * around it each round). Odd entry counts get a bye each round. Unlike the
 * elimination formats, all pairings are known up front, so matches are
 * created fully filled - there's no empty-slot stage.
 */
export async function generateRoundRobin(bracketId: string, entryIds: string[]) {
  if (entryIds.length < 2) throw new Error("Need at least 2 players/teams for a round robin.");
  await prisma.bracket.update({ where: { id: bracketId }, data: { format: "ROUND_ROBIN" } });
  await prisma.bracketMatch.deleteMany({ where: { bracketId } });

  const ids: (string | null)[] = [...entryIds];
  if (ids.length % 2 === 1) ids.push(null); // bye slot
  const n = ids.length;
  const rounds = n - 1;
  const half = n / 2;
  let arr = [...ids];

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a && b) {
        await prisma.bracketMatch.create({
          data: {
            bracketId,
            round: round + 1,
            slot: i,
            bracketSide: "ROUND_ROBIN",
            entryAId: a,
            entryBId: b,
            label: `Round ${round + 1}`,
          },
        });
      }
    }
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop() as string | null);
    arr = [fixed, ...rest];
  }

  return prisma.bracketMatch.findMany({ where: { bracketId }, orderBy: [{ round: "asc" }, { slot: "asc" }] });
}

/** Win/loss standings for a Round Robin bracket, tallied from finished games. */
export async function roundRobinStandings(bracketId: string) {
  const matches = await prisma.bracketMatch.findMany({
    where: { bracketId, bracketSide: "ROUND_ROBIN" },
    include: { game: true },
  });
  const entries = await prisma.bracketEntry.findMany({ where: { bracketId }, include: { playerA: true } });

  const table = new Map<string, { entryId: string; name: string; wins: number; losses: number; played: number }>();
  for (const e of entries) {
    table.set(e.id, { entryId: e.id, name: e.teamName || e.playerA.name, wins: 0, losses: 0, played: 0 });
  }

  for (const m of matches) {
    if (!m.game || m.game.status !== "FINISHED" || !m.game.winningTeam) continue;
    const winnerEntryId = m.game.winningTeam === "A" ? m.entryAId : m.entryBId;
    const loserEntryId = m.game.winningTeam === "A" ? m.entryBId : m.entryAId;
    if (winnerEntryId && table.has(winnerEntryId)) {
      const row = table.get(winnerEntryId)!;
      row.wins += 1;
      row.played += 1;
    }
    if (loserEntryId && table.has(loserEntryId)) {
      const row = table.get(loserEntryId)!;
      row.losses += 1;
      row.played += 1;
    }
  }

  return Array.from(table.values()).sort((a, b) => b.wins - a.wins || a.losses - b.losses);
}
