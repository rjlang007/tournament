import assert from "node:assert/strict";
import test from "node:test";
import { canAdvanceBye } from "./bracket";

type ByeMatch = Parameters<typeof canAdvanceBye>[0];

function match(overrides: Partial<ByeMatch> = {}): ByeMatch {
  return {
    id: "match",
    bracketSide: "WINNERS",
    label: "Round 1",
    entryAId: "player-a",
    entryBId: null,
    winnerEntryId: null,
    nextMatchId: null,
    nextSlot: null,
    loserNextMatchId: null,
    loserNextSlot: null,
    ...overrides,
  };
}

test("advances a first-round bye without an incoming opponent", () => {
  assert.equal(canAdvanceBye(match(), [match()]), true);
});

test("waits for an unresolved match that could feed the empty slot", () => {
  const target = match({ id: "losers-match", bracketSide: "LOSERS" });
  const source = match({ id: "winners-match", entryAId: "a", entryBId: "b", loserNextMatchId: target.id, loserNextSlot: "B" });

  assert.equal(canAdvanceBye(target, [target, source]), false);
});

test("advances once the only incoming path is resolved without a loser", () => {
  const target = match({ id: "losers-match", bracketSide: "LOSERS" });
  const source = match({
    id: "winners-bye",
    winnerEntryId: "player-a",
    loserNextMatchId: target.id,
    loserNextSlot: "B",
  });

  assert.equal(canAdvanceBye(target, [target, source]), true);
});

test("waits until both incoming paths are resolved before clearing an empty branch", () => {
  const target = match({ id: "empty-losers-match", bracketSide: "LOSERS", entryAId: null });
  const resolvedBye = match({
    id: "resolved-winners-bye",
    label: "Round 1 (BYE)",
    winnerEntryId: "player-a",
    loserNextMatchId: target.id,
    loserNextSlot: "A",
  });
  const unresolved = match({
    id: "unresolved-winners-match",
    entryAId: "player-b",
    entryBId: "player-c",
    loserNextMatchId: target.id,
    loserNextSlot: "B",
  });

  assert.equal(canAdvanceBye(target, [target, resolvedBye, unresolved]), false);
  assert.equal(canAdvanceBye(target, [target, resolvedBye, { ...unresolved, winnerEntryId: "player-b" }]), true);
});

test("does not advance a full or already-decided match", () => {
  assert.equal(canAdvanceBye(match({ entryBId: "player-b" }), []), false);
  assert.equal(canAdvanceBye(match({ winnerEntryId: "player-a" }), []), false);
  assert.equal(canAdvanceBye(match({ entryAId: null, label: "Losers Round 1 (BYE)" }), []), false);
});