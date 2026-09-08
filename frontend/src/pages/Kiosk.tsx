import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, Game, Tournament } from "../lib/api";
import { useTournamentSocket } from "../lib/socket";
import TournamentLocationMap from "../components/TournamentLocationMap";

function fmt(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function Kiosk() {
  const { tournamentId } = useParams();
  const [nowPlaying, setNowPlaying] = useState<Game[]>([]);
  const [upNext, setUpNext] = useState<Game[]>([]);
  const [waitingCount, setWaitingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);

  const load = () => {
    setError(null);
    return api.get(`/games/board/${tournamentId}`).then((r) => {
      setNowPlaying(r.data.nowPlaying);
      setUpNext(r.data.upNext);
      setWaitingCount(r.data.waitingCount);
      return api.get(`/tournaments/${tournamentId}`);
    }).then((response) => setTournament(response.data)).catch(() => setError("Live board is temporarily unavailable.")).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [tournamentId]);
  useTournamentSocket(tournamentId, ["games:changed", "courts:changed", "tournament:changed"], load);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowPlaying((games) => games.map((game) => (
        game.status === "IN_PROGRESS"
          ? { ...game, remainingSeconds: Math.max(0, game.remainingSeconds - 1) }
          : game
      )));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="min-h-[calc(100vh-65px)] bg-court-bg p-4 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-[0.28em] text-ball/75">Live tournament board</div>
          <h1 className="font-display text-3xl font-bold tracking-wide text-ball sm:text-4xl">NOW PLAYING</h1>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs text-emerald-200">
          <span className="live-dot" /> Live
        </div>
      </header>
      {error && <div className="error-panel mb-5 flex flex-wrap items-center justify-between gap-3">{error}<button type="button" onClick={load} className="secondary-button px-3 py-1.5 text-xs">Retry</button></div>}
      {loading ? <KioskSkeleton /> : <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 sm:gap-5">
        {nowPlaying.map((g, index) => (
          <div key={g.id} style={{ animationDelay: `${index * 70}ms` }} className="glass-panel animate-[card-rise_420ms_ease_both] border-2 border-court-line/20 bg-black/30 p-5 text-center">
            <div className="text-xs uppercase text-white/50 tracking-widest mb-2">{g.court?.label ?? "Court"}</div>
            <Names game={g} team="A" />
            <div className="text-ball font-display font-bold text-sm my-1">VS</div>
            <Names game={g} team="B" />
            <div className="font-display text-5xl mt-4 tabular-nums">{fmt(g.remainingSeconds)}</div>
            <div className={`text-xs mt-1 uppercase tracking-widest ${g.status === "PAUSED" ? "text-yellow-400" : "text-green-400"}`}>{g.status}</div>
          </div>
        ))}
        {nowPlaying.length === 0 && <p className="col-span-full rounded-2xl border border-dashed border-white/10 p-10 text-center text-white/40">No games in progress</p>}
      </div>}

      <h2 className="mb-4 text-center font-display text-2xl font-bold tracking-wide text-white">UP NEXT · 3 LINEUPS</h2>
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 sm:gap-4">
        {[0, 1, 2].map((index) => {
          const game = upNext[index];
          return game ? (
            <div key={game.id} className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
              <div className="mb-1 text-xs text-white/40">#{index + 1} in queue</div>
              <Names game={game} team="A" small />
              <div className="my-1 text-xs font-bold text-ball">VS</div>
              <Names game={game} team="B" small />
            </div>
          ) : (
            <div key={`empty-${index}`} className="flex min-h-[112px] items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-center text-xs uppercase tracking-[0.14em] text-white/30">
              #{index + 1} awaiting eligible players
            </div>
          );
        })}
      </div>

      <p className="text-center text-white/40 text-sm">{waitingCount} players waiting in the pool</p>

      {(tournament?.locationName || tournament?.locationAddress || (tournament?.locationLatitude !== null && tournament?.locationLatitude !== undefined && tournament?.locationLongitude !== null && tournament?.locationLongitude !== undefined)) && (
        <section className="mx-auto mt-10 max-w-4xl rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-6">
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-[0.25em] text-ball/75">Tournament venue</div>
            <h2 className="mt-1 font-display text-2xl font-bold text-white">{tournament.locationName || "Playing location"}</h2>
            {tournament.locationAddress && <p className="mt-1 text-sm text-white/60">{tournament.locationAddress}</p>}
          </div>
          {tournament.locationLatitude !== null && tournament.locationLatitude !== undefined && tournament.locationLongitude !== null && tournament.locationLongitude !== undefined && (
            <TournamentLocationMap latitude={tournament.locationLatitude} longitude={tournament.locationLongitude} />
          )}
        </section>
      )}
    </div>
  );
}

function KioskSkeleton() {
  return <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 sm:gap-5">
    {[0, 1, 2].map((item) => <div key={item} className="glass-panel h-56 p-5"><div className="skeleton mx-auto h-3 w-20" /><div className="skeleton mx-auto mt-8 h-5 w-36" /><div className="skeleton mx-auto mt-3 h-5 w-28" /><div className="skeleton mx-auto mt-8 h-10 w-24" /></div>)}
  </div>;
}

function Names({ game, team, small }: { game: Game; team: "A" | "B"; small?: boolean }) {
  const teamPlayers = game.players.filter((p) => p.team === team);
  return <div className={small ? "flex flex-wrap justify-center gap-2 text-sm font-display" : "flex flex-wrap justify-center gap-2 font-display text-lg"}>{teamPlayers.length > 0 ? teamPlayers.map((p) => <span key={p.id} className="inline-flex flex-col leading-tight"><span>{p.player.name}</span><span className={`text-[9px] uppercase tracking-[0.12em] ${p.player.skillLevel === "ADVANCE" ? "text-red-300" : p.player.skillLevel === "AVERAGE" ? "text-orange-300" : "text-blue-300"}`}>{p.player.skillLevel}</span></span>) : "—"}</div>;
}
