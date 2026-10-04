import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, LeaderboardRow } from "../lib/api";
import { useTournamentSocket } from "../lib/socket";
import TournamentViewsNav from "../components/TournamentViewsNav";

type FinalResult = {
  tournamentName: string;
  finalized: boolean;
  finalizedAt: string | null;
  standings: LeaderboardRow[] | null;
};

function renderResultsCanvas(tournamentName: string, rows: LeaderboardRow[]): HTMLCanvasElement | null {
  const width = 1400;
  const rowHeight = 58;
  const height = 400 + rows.length * rowHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#071e2b");
  background.addColorStop(1, "#123d3a");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#d9f99e";
  context.font = "700 24px Arial, sans-serif";
  context.fillText("PLAYWELL", 72, 58);
  context.fillStyle = "#b8d4d0";
  context.font = "400 16px Arial, sans-serif";
  context.fillText("FIND A GAME. BRING THE FUN.", 72, 86);
  context.fillStyle = "#d9f99e";
  context.font = "700 24px Georgia, serif";
  context.fillText("FINAL STANDINGS", 72, 142);
  context.fillStyle = "#ffffff";
  context.font = "700 58px Georgia, serif";
  context.fillText("Congratulations!", 72, 214);
  context.fillStyle = "#b8d4d0";
  context.font = "400 25px Arial, sans-serif";
  context.fillText(tournamentName, 72, 255);

  const winner = rows[0];
  if (winner) {
    context.fillStyle = "#d9f99d";
    context.font = "700 24px Arial, sans-serif";
    context.fillText(`Champion: ${winner.name}`, 72, 302);
  }

  const tableTop = 330;
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

  context.fillStyle = "#b8d4d0";
  context.font = "400 15px Arial, sans-serif";
  context.fillText("Playwell · Find a game. Bring the fun.", 72, height - 24);
  return canvas;
}

function resultsFilename(tournamentName: string) {
  return `${tournamentName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "tournament"}-results.png`;
}

function downloadResultsImage(tournamentName: string, rows: LeaderboardRow[]) {
  const canvas = renderResultsCanvas(tournamentName, rows);
  if (!canvas) return;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = resultsFilename(tournamentName);
    link.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

async function shareResultsImage(tournamentName: string, rows: LeaderboardRow[]) {
  const canvas = renderResultsCanvas(tournamentName, rows);
  if (!canvas) return;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  const file = new File([blob], resultsFilename(tournamentName), { type: "image/png" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title: `${tournamentName} final results`, text: "Find a game. Bring the fun.", files: [file] });
    return;
  }
  downloadResultsImage(tournamentName, rows);
}

export default function Leaderboard() {
  const { tournamentId } = useParams();
  const [liveRows, setLiveRows] = useState<LeaderboardRow[]>([]);
  const [final, setFinal] = useState<FinalResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    return Promise.all([
      api.get(`/leaderboard/${tournamentId}`),
      api.get(`/leaderboard/${tournamentId}/final`),
    ]).then(([liveResponse, finalResponse]) => {
      setLiveRows(liveResponse.data);
      setFinal(finalResponse.data);
    }).catch(() => setError("Results are temporarily unavailable.")).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [tournamentId]);
  useTournamentSocket(tournamentId, ["games:changed", "tournament:changed"], load);

  const isFinal = !!final?.finalized;
  const rows = isFinal && final?.standings ? final.standings : liveRows;
  const podiumRows = rows.slice(0, 3);
  const totalGames = rows.reduce((sum, row) => sum + row.gamesPlayed, 0);
  const leader = rows[0];
  const topWinRate = rows.reduce((best, row) => (row.winPct > best.winPct ? row : best), rows[0] ?? { winPct: 0, name: "—" } as LeaderboardRow);
  const exportName = final?.tournamentName ?? "Playwell";
  const onShareResults = async () => {
    setShareError(null);
    try {
      await shareResultsImage(exportName, rows);
    } catch (shareFailure: any) {
      if (shareFailure?.name !== "AbortError") setShareError("Could not share the results image.");
    }
  };

  return (
    <div className="leaderboard-page mx-auto max-w-5xl space-y-6">
      {tournamentId && <TournamentViewsNav tournamentId={tournamentId} />}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-white/45">Results</div>
          <h2 className="mt-2 font-display text-3xl font-bold text-white">{isFinal ? "Final Standings" : "Leaderboard"}</h2>
        </div>
        <div className="leaderboard-actions flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => window.print()} className="secondary-button px-3 py-2 text-xs">Print standings</button>
          <button type="button" onClick={() => downloadResultsImage(exportName, rows)} disabled={rows.length === 0} className="secondary-button px-3 py-2 text-xs">Save PNG</button>
          <button type="button" onClick={onShareResults} disabled={rows.length === 0} className="action-button px-3 py-2 text-xs">Share results</button>
          {isFinal && final?.finalizedAt && (
            <div className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-red-300">
              Recorded {new Date(final.finalizedAt).toLocaleString(undefined, {
                month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
              })}
            </div>
          )}
        </div>
      </header>

      {error && <div className="error-panel flex flex-wrap items-center justify-between gap-3">{error}<button type="button" onClick={load} className="secondary-button px-3 py-1.5 text-xs">Retry</button></div>}
      {shareError && <p role="alert" className="text-sm text-advance">{shareError}</p>}

      {loading ? <LeaderboardSkeleton /> : <>

      {isFinal && final?.standings && (
        <section className="final-results-banner overflow-hidden rounded-3xl border border-ball/30 bg-gradient-to-br from-ball/20 via-white/5 to-emerald-500/10 p-6 shadow-2xl shadow-ball/10 sm:p-8">
          <div className="max-w-3xl">
            <div className="text-xs font-bold uppercase tracking-[0.28em] text-ball">Official tournament results</div>
            <h1 className="mt-3 font-display text-4xl font-bold text-white sm:text-5xl">Congratulations to {leader?.name ?? "our players"}!</h1>
            <p className="mt-3 text-base leading-7 text-white/70">The tournament is complete. Here are the final rankings, including every player who competed.</p>
          </div>
        </section>
      )}

      {podiumRows.length > 0 && <section className="podium-stage" aria-label="Top three standings">
        <div className="mb-5 flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-ball">The podium</div>
            <h3 className="mt-2 font-display text-3xl font-bold text-white">Standout players</h3>
          </div>
          <div className="hidden text-right text-xs text-white/45 sm:block">Overall performance</div>
        </div>
        <div className="podium-grid">
          {podiumRows.map((row, index) => {
            const rank = index + 1;
            const medal = rank === 1 ? "🏆" : rank === 2 ? "🥈" : "🥉";
            return <article key={row.playerId} className={`podium-card podium-rank-${rank}`}>
              <div className="flex items-start justify-between gap-3">
                <span className="podium-medal" aria-hidden="true">{medal}</span>
                <span className="podium-rank">{rank === 1 ? "CHAMPION" : `${rank}${rank === 2 ? "ND" : "RD"}`}</span>
              </div>
              <h4 className="mt-5 truncate font-display text-2xl font-bold text-white">{row.name}</h4>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <div className="font-display text-3xl font-bold text-white">{row.wins}</div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">Wins</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-white">{row.winPct}%</div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">Win rate</div>
                </div>
              </div>
            </article>;
          })}
        </div>
      </section>}

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
              <th className="px-4 py-3 text-center">Points</th>
              <th className="px-4 py-3 text-center">Loss pts</th>
              <th className="px-4 py-3 text-center">Point diff</th>
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
                <td className="px-4 py-3 text-center text-white/80">{r.pointsFor}</td>
                <td className="px-4 py-3 text-center text-orange-200">{r.lossPoints}</td>
                <td className="px-4 py-3 text-center text-white/80">{r.pointDiff > 0 ? `+${r.pointDiff}` : r.pointDiff}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && <p className="p-4 text-sm text-white/45">No results yet.</p>}
      </section>
      </>}
    </div>
  );
}

function LeaderboardSkeleton() {
  return <div className="space-y-4">
    <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="glass-panel h-28 p-4"><div className="skeleton h-3 w-24" /><div className="skeleton mt-5 h-7 w-32" /></div>)}</div>
    <div className="glass-panel space-y-3 p-5">{[0, 1, 2, 3, 4].map((item) => <div key={item} className="skeleton h-10 w-full" />)}</div>
  </div>;
}
