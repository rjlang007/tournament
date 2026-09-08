import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, LeaderboardRow } from "../lib/api";
import { useTournamentSocket } from "../lib/socket";

type FinalResult = {
  tournamentName: string;
  finalized: boolean;
  finalizedAt: string | null;
  standings: LeaderboardRow[] | null;
};

function downloadResultsImage(
  tournamentName: string,
  rows: LeaderboardRow[],
  format: "png" | "jpeg",
) {
  const width = 1400;
  const rowHeight = 58;
  const height = 300 + rows.length * rowHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;

  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#071e2b");
  background.addColorStop(1, "#123d3a");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#d9f99d";
  context.font = "700 28px Georgia, serif";
  context.fillText("TOURNAMENT RESULTS", 72, 72);
  context.fillStyle = "#ffffff";
  context.font = "700 58px Georgia, serif";
  context.fillText("Congratulations!", 72, 145);
  context.fillStyle = "#b8d4d0";
  context.font = "400 25px Arial, sans-serif";
  context.fillText(tournamentName, 72, 188);

  const winner = rows[0];
  if (winner) {
    context.fillStyle = "#d9f99d";
    context.font = "700 24px Arial, sans-serif";
    context.fillText(`Champion: ${winner.name}`, 72, 238);
  }

  const tableTop = 278;
  context.fillStyle = "rgba(255, 255, 255, 0.12)";
  context.fillRect(52, tableTop, width - 104, 48);
  context.fillStyle = "#b8d4d0";
  context.font = "700 18px Arial, sans-serif";
  context.fillText("RANK", 78, tableTop + 31);
  context.fillText("PLAYER", 190, tableTop + 31);
  context.fillText("RECORD", 910, tableTop + 31);
  context.fillText("WIN %", 1170, tableTop + 31);

  rows.forEach((row, index) => {
    const y = tableTop + 48 + index * rowHeight;
    context.fillStyle = index % 2 === 0 ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.04)";
    context.fillRect(52, y, width - 104, rowHeight);
    context.fillStyle = index === 0 ? "#d9f99d" : "#ffffff";
    context.font = "700 22px Arial, sans-serif";
    context.fillText(String(index + 1), 82, y + 36);
    context.font = "600 22px Arial, sans-serif";
    context.fillText(row.name, 190, y + 36);
    context.fillStyle = "#b8d4d0";
    context.font = "400 20px Arial, sans-serif";
    context.fillText(`${row.wins}W - ${row.losses}L`, 910, y + 36);
    context.fillText(`${row.winPct}%`, 1170, y + 36);
  });

  const mime = format === "png" ? "image/png" : "image/jpeg";
  const extension = format === "png" ? "png" : "jpg";
  canvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${tournamentName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "tournament"}-results.${extension}`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, mime, format === "jpeg" ? 0.95 : undefined);
}

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

      {isFinal && final?.standings && (
        <section className="overflow-hidden rounded-3xl border border-ball/30 bg-gradient-to-br from-ball/20 via-white/5 to-emerald-500/10 p-6 shadow-2xl shadow-ball/10 sm:p-8">
          <div className="max-w-3xl">
            <div className="text-xs font-bold uppercase tracking-[0.28em] text-ball">Official tournament results</div>
            <h1 className="mt-3 font-display text-4xl font-bold text-white sm:text-5xl">Congratulations to {leader?.name ?? "our players"}!</h1>
            <p className="mt-3 text-base leading-7 text-white/70">The tournament is complete. Here are the final rankings, including every player who competed.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button type="button" onClick={() => downloadResultsImage(final.tournamentName, final.standings!, "png")} className="rounded-xl bg-ball px-4 py-2.5 text-sm font-bold text-neutral-950">
                Download PNG
              </button>
              <button type="button" onClick={() => downloadResultsImage(final.tournamentName, final.standings!, "jpeg")} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white">
                Download JPEG
              </button>
            </div>
          </div>
        </section>
      )}

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
