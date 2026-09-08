import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, Game } from "../lib/api";
import { useTournamentSocket } from "../lib/socket";

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

  const load = () =>
    api.get(`/games/board/${tournamentId}`).then((r) => {
      setNowPlaying(r.data.nowPlaying);
      setUpNext(r.data.upNext);
      setWaitingCount(r.data.waitingCount);
    });

  useEffect(() => { load(); }, [tournamentId]);
  useTournamentSocket(tournamentId, ["games:changed", "courts:changed", "timer:tick"], load);

  return (
    <div className="min-h-[calc(100vh-65px)] bg-court-bg p-4 sm:p-8">
      <h1 className="font-display text-3xl font-bold text-ball mb-6 text-center tracking-wide">NOW PLAYING</h1>
      <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 sm:gap-5">
        {nowPlaying.map((g) => (
          <div key={g.id} className="bg-black/30 border-2 border-court-line/20 rounded-2xl p-5 text-center">
            <div className="text-xs uppercase text-white/50 tracking-widest mb-2">{g.court?.label ?? "Court"}</div>
            <Names game={g} team="A" />
            <div className="text-ball font-display font-bold text-sm my-1">VS</div>
            <Names game={g} team="B" />
            <div className="font-display text-5xl mt-4 tabular-nums">{fmt(g.remainingSeconds)}</div>
            <div className={`text-xs mt-1 uppercase tracking-widest ${g.status === "PAUSED" ? "text-yellow-400" : "text-green-400"}`}>{g.status}</div>
          </div>
        ))}
        {nowPlaying.length === 0 && <p className="col-span-full text-center text-white/40">No games in progress</p>}
      </div>

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
    </div>
  );
}

function Names({ game, team, small }: { game: Game; team: "A" | "B"; small?: boolean }) {
  const teamPlayers = game.players.filter((p) => p.team === team);
  return <div className={small ? "flex flex-wrap justify-center gap-2 text-sm font-display" : "flex flex-wrap justify-center gap-2 font-display text-lg"}>{teamPlayers.length > 0 ? teamPlayers.map((p) => <span key={p.id} className="inline-flex flex-col leading-tight"><span>{p.player.name}</span><span className={`text-[9px] uppercase tracking-[0.12em] ${p.player.skillLevel === "ADVANCE" ? "text-red-300" : p.player.skillLevel === "AVERAGE" ? "text-orange-300" : "text-blue-300"}`}>{p.player.skillLevel}</span></span>) : "—"}</div>;
}
