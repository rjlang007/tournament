import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, LeaderboardRow } from "../lib/api";
import { useTournamentSocket } from "../lib/socket";

type FinalResult = {
  finalized: boolean;
  finalizedAt: string | null;
  standings: LeaderboardRow[] | null;
};

export default function Leaderboard() {
  const { tournamentId } = useParams();
  const [liveRows, setLiveRows] = useState<LeaderboardRow[]>([]);
  const [final, setFinal] = useState<FinalResult | null>(null);

  const load = () => {
    api.get(`/leaderboard/${tournamentId}`).then((r) => setLiveRows(r.data));
    api.get(`/leaderboard/${tournamentId}/final`).then((r) => setFinal(r.data));
  };
  useEffect(() => { load(); }, [tournamentId]);
  useTournamentSocket(tournamentId, ["games:changed", "tournament:changed"], load);

  const isFinal = !!final?.finalized;
  const rows = isFinal && final?.standings ? final.standings : liveRows;
  const totalGames = rows.reduce((sum, row) => sum + row.gamesPlayed, 0);
  const leader = rows[0];
  const topWinRate = rows.reduce((best, row) => (row.winPct > best.winPct ? row : best), rows[0] ?? { winPct: 0, name: "—" } as LeaderboardRow);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-white/45">Results</div>
          <h2 className="mt-2 font-display text-3xl font-bold text-white">{isFinal ? "Final Standings" : "Leaderboard"}</h2>
        </div>
        {isFinal && final?.finalizedAt && (
          <div className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-red-300">
            Recorded {new Date(final.finalizedAt).toLocaleString(undefined, {
              month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
            })}
          </div>
        )}
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="glass-panel p-4">
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Current leader</div>
          <div className="mt-3 font-display text-2xl font-bold text-ball">{leader ? leader.name : "—"}</div>
          <div className="mt-1 text-sm text-white/60">{leader ? `${leader.wins} wins • ${leader.losses} losses` : "No results yet"}</div>
        </div>
        <div className="glass-panel p-4">
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Games played</div>
          <div className="mt-3 font-display text-2xl font-bold text-white">{totalGames}</div>
          <div className="mt-1 text-sm text-white/60">Total recorded matches</div>
        </div>
        <div className="glass-panel p-4">
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Best win rate</div>
          <div className="mt-3 font-display text-2xl font-bold text-emerald-300">{topWinRate.name}</div>
          <div className="mt-1 text-sm text-white/60">{Math.round(topWinRate.winPct)}% win percentage</div>
        </div>
      </div>

      {isFinal && (
        <p className="text-sm text-white/55">
          These results are officially locked in. If the operator extends the tournament, this page will switch back to live standings.
        </p>
      )}

      <section className="glass-panel mobile-data-table overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-white/[0.02]">
            <tr className="text-[10px] uppercase tracking-[0.18em] text-white/45">
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Player</th>
              <th className="px-4 py-3">Level</th>
              <th className="px-4 py-3 text-center">Games</th>
              <th className="px-4 py-3 text-center">W</th>
              <th className="px-4 py-3 text-center">L</th>
              <th className="px-4 py-3 text-center">Win %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.playerId} className="border-t border-white/10">
                <td className="px-4 py-3 text-white/65">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                </td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-white">{r.name}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`skill-badge-${r.skillLevel} rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.14em]`}>
                    {r.skillLevel}
                  </span>
                </td>
                <td className="px-4 py-3 text-center text-white/80">{r.gamesPlayed}</td>
                <td className="px-4 py-3 text-center font-bold text-emerald-300">{r.wins}</td>
                <td className="px-4 py-3 text-center font-bold text-red-300">{r.losses}</td>
                <td className="px-4 py-3 text-center text-white/80">{r.winPct}%</td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && <p className="p-4 text-sm text-white/45">No results yet.</p>}
      </section>
    </div>
  );
}
