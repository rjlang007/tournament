import assert from "node:assert/strict";
import test from "node:test";
import { buildDoublesGame, isEligiblePair, isEligibleTeamMatchup, lineupKey, QueuedPlayer } from "./matchmaking";

const beginner = "BEGINNER" as const;
const average = "AVERAGE" as const;
const advance = "ADVANCE" as const;

test("allows only the approved team matchups", () => {
  const allowed = [
    [[beginner, beginner], [beginner, beginner]],
    [[advance, beginner], [advance, beginner]],
    [[advance, beginner], [average, average]],
    [[average, average], [average, average]],
    [[average, beginner], [average, beginner]],
    [[advance, average], [advance, average]],
    [[advance, advance], [advance, advance]],
  ] as const;

  for (const [teamA, teamB] of allowed) {
    assert.equal(isEligiblePair(teamA[0], teamA[1]), true);
    assert.equal(isEligiblePair(teamB[0], teamB[1]), true);
    assert.equal(isEligibleTeamMatchup(teamA, teamB), true);
  }
});

test("rejects unbalanced or unlisted team matchups", () => {
  const rejected = [
    [[beginner, beginner], [advance, beginner]],
    [[beginner, beginner], [average, beginner]],
    [[beginner, beginner], [advance, advance]],
    [[advance, beginner], [advance, advance]],
    [[average, average], [advance, average]],
    [[average, beginner], [average, average]],
  ] as const;

  for (const [teamA, teamB] of rejected) {
    assert.equal(isEligibleTeamMatchup(teamA, teamB), false);
  }
});

function player(id: string, skillLevel: typeof beginner | typeof average | typeof advance): QueuedPlayer {
  return {
    id,
    name: id,
    skillLevel,
    gamesPlayed: 0,
    arrivalAt: Date.now(),
    queuedAt: Date.now(),
    wins: 0,
    losses: 0,
    recentPartnerIds: new Set(),
    recentOpponentIds: new Set(),
  };
}

test("does not repeat a four-player lineup while allowing new pairings", () => {
  const pool = [
    player("a", advance),
    player("b", beginner),
    player("c", average),
    player("d", beginner),
    player("e", advance),
  ];
  const previousLineup = lineupKey(["a", "b", "c", "d"]);
  const result = buildDoublesGame(pool, { usedLineupKeys: new Set([previousLineup]) });

  assert.ok(result.game);
  assert.notEqual(lineupKey(result.game.teamA.concat(result.game.teamB).map((p) => p.id)), previousLineup);
});
