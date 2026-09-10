import assert from "node:assert/strict";
import test from "node:test";
import { isEligibleTeamMatchup } from "./matchmaking";

const beginner = "BEGINNER" as const;
const average = "AVERAGE" as const;
const advance = "ADVANCE" as const;

test("allows only balanced doubles skill compositions", () => {
  const allowed = [
    [[beginner, beginner], [beginner, beginner]],
    [[advance, beginner], [advance, beginner]],
    [[advance, beginner], [average, average]],
    [[average, average], [average, average]],
    [[average, beginner], [average, beginner]],
    [[advance, average], [advance, average]],
  ] as const;

  for (const [teamA, teamB] of allowed) {
    assert.equal(isEligibleTeamMatchup(teamA, teamB), true);
  }
});

test("rejects unbalanced cross-tier matchups", () => {
  const rejected = [
    [[beginner, beginner], [beginner, advance]],
    [[beginner, beginner], [beginner, average]],
    [[average, beginner], [average, average]],
    [[average, beginner], [average, advance]],
    [[average, beginner], [advance, beginner]],
  ] as const;

  for (const [teamA, teamB] of rejected) {
    assert.equal(isEligibleTeamMatchup(teamA, teamB), false);
  }
});
