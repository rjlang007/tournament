import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fileUrl, GlobalLeaderboards, PlayerLeaderboardRow } from "../../lib/api";

type BoardKey = "openPlay" | "tournaments" | "overall";

const boards: { key: BoardKey; label: string; description: string }[] = [
  { key: "overall", label: "Overall", description: "Combined points from open play and tournaments" },
  { key: "openPlay", label: "Open play", description: "3 points for 1st, 2 for 2nd, and 1 for 3rd" },
  { key: "tournaments", label: "Tournaments", description: "6 points for 1st, 3 for 2nd, and 1 for 3rd" },
];

function pointsFor(row: PlayerLeaderboardRow, board: BoardKey) {
  if (board === "openPlay") return row.openPlayPoints;
  if (board === "tournaments") return row.tournamentPoints;
  return row.overallPoints;
}

export default function CommunityLeaderboard() {
  const [data, setData] = useState<GlobalLeaderboards | null>(null);
  const [activeBoard, setActiveBoard] = useState<BoardKey>("overall");
  const [season, setSeason] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    setError(null);
    api.get<GlobalLeaderboards>("/leaderboard/global", { params: season === null ? {} : { season } })
      .then(({ data: response }) => setData(response))
      .catch(() => setError("Player rankings are temporarily unavailable."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [season]);

  const selected = boards.find((board) => board.key === activeBoard) ?? boards[0];
  const rows = data?.[activeBoard] ?? [];
  const podium = rows.slice(0, 3);

  return (
    <div className="space-y-6">
      <header className="rounded-3xl border border-ball/20 bg-gradient-to-br from-ball/15 via-white/[0.03] to-emerald-500/10 p-6 sm:p-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-ball">Player hub</p>
        <h1 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">Global leaderboards</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
          Earn points by finishing on the podium. Points are added after event results are finalized.
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Leaderboard category">
        {boards.map((board) => (
          <button
            key={board.key}
            type="button"
            role="tab"
            aria-selected={activeBoard === board.key}
            onClick={() => setActiveBoard(board.key)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              activeBoard === board.key ? "bg-ball text-neutral-900" : "border border-white/10 bg-white/5 text-white/65 hover:text-white"
            }`}
          >
            {board.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="leaderboard-season" className="text-sm text-white/55">Season</label>
        <select
          id="leaderboard-season"
          value={season ?? ""}
          onChange={(event) => setSeason(event.target.value ? Number(event.target.value) : null)}
          className="rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white"
        >
          <option value="">All-time</option>
          {data?.seasons.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      </div>

      <p className="text-sm text-white/50">{selected.description}</p>
      {error && <div className="rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200">{error} <button onClick={load} className="ml-2 underline">Retry</button></div>}
      {loading && <p className="text-white/55">Loading player rankings…</p>}
      {!loading && !error && rows.length === 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-white/55">
          No player results yet. Finalized event podiums will appear here.
        </div>
      )}

      {!loading && !error && podium.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-3" aria-label="Top three players">
          {podium.map((row, index) => (
            <Link
              key={row.userId}
              to={`/community/profile/${encodeURIComponent(row.username)}`}
              className={`rounded-2xl border p-5 transition hover:-translate-y-0.5 hover:border-ball/50 ${
                index === 0 ? "border-ball/30 bg-ball/10 sm:-translate-y-2" : "border-white/10 bg-white/[0.03]"
              }`}
            >
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">{["🥇 Champion", "🥈 Runner-up", "🥉 Third place"][index]}</div>
              <div className="mt-4 flex items-center gap-3">
                {row.avatarUrl ? <img src={fileUrl(row.avatarUrl)} alt="" className="h-12 w-12 rounded-full border border-white/15 object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 font-display text-xl text-ball">{row.username[0]?.toUpperCase()}</div>}
                <div className="min-w-0">
                  <div className="truncate font-display text-lg font-bold text-white">{row.username}</div>
                  <div className="text-xs text-white/45">{row.rankTier} · {row.wins}W – {row.losses}L · {row.winRate}% win rate</div>
                </div>
              </div>
              <div className="mt-5 font-display text-3xl font-bold text-ball">{pointsFor(row, activeBoard)} <span className="text-sm font-medium text-white/45">pts</span></div>
            </Link>
          ))}
        </section>
      )}

      {!loading && !error && rows.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-white/[0.04] text-[10px] uppercase tracking-[0.18em] text-white/45">
                <tr>
                  <th className="px-4 py-3">Rank</th>
                  <th className="px-4 py-3">Player</th>
                  <th className="px-4 py-3">Tier</th>
                  <th className="px-4 py-3 text-center">Points</th>
                  <th className="px-4 py-3 text-center">Podiums</th>
                  <th className="px-4 py-3 text-center">Record</th>
                  <th className="px-4 py-3 text-center">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.userId} className="border-t border-white/10">
                    <td className="px-4 py-3 font-display font-bold text-white/55">{index < 3 ? ["🥇", "🥈", "🥉"][index] : index + 1}</td>
                    <td className="px-4 py-3">
                      <Link to={`/community/profile/${encodeURIComponent(row.username)}`} className="flex items-center gap-3 font-semibold text-white hover:text-ball">
                        {row.avatarUrl ? <img src={fileUrl(row.avatarUrl)} alt="" className="h-9 w-9 rounded-full object-cover" /> : <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-ball">{row.username[0]?.toUpperCase()}</div>}
                        {row.username}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold text-ball">{row.rankTier}</td>
                    <td className="px-4 py-3 text-center font-bold text-ball">{pointsFor(row, activeBoard)}</td>
                    <td className="px-4 py-3 text-center text-white/70">{row.podiums}</td>
                    <td className="px-4 py-3 text-center text-white/70">{row.wins}W – {row.losses}L</td>
                    <td className="px-4 py-3 text-center text-white/70">{row.winRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
