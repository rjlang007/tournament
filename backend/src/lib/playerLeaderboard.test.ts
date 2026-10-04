import assert from "node:assert/strict";
import { test } from "node:test";
import { PlayerAccount, buildPlayerLeaderboard } from "./playerLeaderboard";

function account(
  username: string,
  tournamentType: "RANDOM_PAIRING" | "FIXED_BRACKET",
  place: number,
  finishedAt: Date | null = new Date(),
): PlayerAccount {
  const id = `${username}-profile`;
  const standings = Array.from({ length: 3 }, (_, index) => ({ playerId: `player-${index + 1}` }));
  standings[place - 1] = { playerId: id };
  return {
    id: `${username}-user`,
    username,
    avatarUrl: null,
    playerProfiles: [{
      id,
      tournament: {
        type: tournamentType,
        finalStandings: standings,
        resultsFinalizedAt: finishedAt,
      },
      gamePlayers: [
        { team: "A", game: { winningTeam: "A" } },
        { team: "A", game: { winningTeam: "B" } },
        { team: "B", game: { winningTeam: null } },
      ],
    }],
  };
}

test("awards separate podium points for open play and tournament events", () => {
  const rows = buildPlayerLeaderboard([
    account("open-champion", "RANDOM_PAIRING", 1),
    account("open-runner-up", "RANDOM_PAIRING", 2),
    account("open-third", "RANDOM_PAIRING", 3),
    account("tournament-champion", "FIXED_BRACKET", 1),
    account("tournament-runner-up", "FIXED_BRACKET", 2),
    account("tournament-third", "FIXED_BRACKET", 3),
  ]);
  const byName = Object.fromEntries(rows.map((row) => [row.username, row]));

  assert.equal(byName["open-champion"].openPlayPoints, 3);
  assert.equal(byName["open-runner-up"].openPlayPoints, 2);
  assert.equal(byName["open-third"].openPlayPoints, 1);
  assert.equal(byName["tournament-champion"].tournamentPoints, 6);
  assert.equal(byName["tournament-runner-up"].tournamentPoints, 3);
  assert.equal(byName["tournament-third"].tournamentPoints, 1);
  assert.equal(byName["tournament-champion"].openPlayPoints, 0);
  assert.equal(byName["open-champion"].tournamentPoints, 0);
});

test("uses combined points and completed-game results for player career stats", () => {
  const openPlay = account("career-player", "RANDOM_PAIRING", 1);
  const tournament = account("career-player", "FIXED_BRACKET", 2);
  tournament.playerProfiles[0].id = "career-player-tournament";
  const tournamentStandings = tournament.playerProfiles[0].tournament.finalStandings;
  assert.ok(Array.isArray(tournamentStandings));
  tournament.playerProfiles[0].tournament.finalStandings = [
    { playerId: "another-player" },
    { playerId: "career-player-tournament" },
    { playerId: "third-player" },
  ];

  const row = buildPlayerLeaderboard([{
    ...openPlay,
    playerProfiles: [...openPlay.playerProfiles, ...tournament.playerProfiles],
  }])[0];

  assert.equal(row.openPlayPoints, 3);
  assert.equal(row.tournamentPoints, 3);
  assert.equal(row.overallPoints, 6);
  assert.equal(row.wins, 2);
  assert.equal(row.losses, 2);
  assert.equal(row.gamesPlayed, 4);
  assert.equal(row.winRate, 50);
  assert.equal(row.podiums, 2);
});

test("does not award points from standings that are not finalized", () => {
  const row = buildPlayerLeaderboard([
    account("unfinished", "RANDOM_PAIRING", 1, null),
  ])[0];

  assert.equal(row.openPlayPoints, 0);
  assert.equal(row.overallPoints, 0);
  assert.equal(row.wins, 1);
  assert.equal(row.losses, 1);
});

test("seasonal points include only podiums finalized in that calendar year", () => {
  const previousSeason = account("seasonal-player", "RANDOM_PAIRING", 1, new Date("2025-11-12T00:00:00Z"));
  const currentSeason = account("seasonal-player", "FIXED_BRACKET", 1, new Date("2026-02-12T00:00:00Z"));
  currentSeason.playerProfiles[0].id = "2026-profile";
  currentSeason.playerProfiles[0].tournament.finalStandings = [{ playerId: "2026-profile" }];
  const result = buildPlayerLeaderboard([{
    ...previousSeason,
    playerProfiles: [...previousSeason.playerProfiles, ...currentSeason.playerProfiles],
  }], 2026)[0];

  assert.equal(result.openPlayPoints, 0);
  assert.equal(result.tournamentPoints, 6);
  assert.equal(result.overallPoints, 6);
  assert.equal(result.wins, 1);
  assert.equal(result.losses, 1);
  assert.equal(result.gamesPlayed, 2);
  assert.equal(result.eventsPlayed, 1);
  assert.equal(result.podiums, 1);
});

test("assigns a rank tier and achievement badges from career results", () => {
  const player = account("badge-player", "RANDOM_PAIRING", 1);
  player.playerProfiles[0].gamePlayers = Array.from({ length: 20 }, (_, index) => ({
    team: "A" as const,
    game: { winningTeam: index < 16 ? "A" as const : "B" as const },
  }));
  const result = buildPlayerLeaderboard([player])[0];

  assert.equal(result.rankTier, "Rookie");
  assert.deepEqual(result.badges, ["Champion", "First podium", "Match winner", "Win-rate ace"]);
});
