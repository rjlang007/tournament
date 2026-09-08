import { FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, RaffleDraw, RaffleResponse } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useTournamentSocket } from "../lib/socket";

export default function Raffle() {
  const { tournamentId } = useParams();
  const { user } = useAuth();
  const canSpin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";
  const [participants, setParticipants] = useState<RaffleResponse["participants"]>([]);
  const [latestDraw, setLatestDraw] = useState<RaffleDraw | null>(null);
  const [prizeDescription, setPrizeDescription] = useState("");
  const [spinningName, setSpinningName] = useState("");
  const [spinning, setSpinning] = useState(false);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [error, setError] = useState("");

  const load = () => {
    if (!tournamentId) return;
    api.get<RaffleResponse>(`/raffles/${tournamentId}`).then(({ data }) => {
      setParticipants(data.participants);
      setLatestDraw(data.latestDraw);
    });
  };

  useEffect(() => { load(); }, [tournamentId]);
  useTournamentSocket(tournamentId, ["games:changed", "players:changed", "raffle:changed"], load);

  const spin = async (event: FormEvent) => {
    event.preventDefault();
    if (!tournamentId || spinning) return;
    setError("");
    setSpinning(true);
    setWheelRotation((rotation) => rotation + 2160 + Math.floor(Math.random() * 360));
    try {
      const { data } = await api.post<{ draw: RaffleDraw; participants: RaffleResponse["participants"] }>(
        `/raffles/${tournamentId}/spin`,
        { prizeDescription },
      );
      setParticipants(data.participants);
      setPrizeDescription("");
      let index = 0;
      const interval = window.setInterval(() => {
        setSpinningName(data.participants[index % data.participants.length].name);
        index++;
      }, 90);
      window.setTimeout(() => {
        window.clearInterval(interval);
        setSpinningName(data.draw.winnerName);
        setLatestDraw(data.draw);
        setSpinning(false);
      }, 6400);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "The raffle could not be started.");
      setSpinning(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-ball/80">Live tournament feature</div>
          <h1 className="mt-2 font-display text-4xl font-bold text-white">Raffle</h1>
          <p className="mt-2 max-w-xl text-sm text-white/55">Every player currently assigned to an active game is automatically entered.</p>
        </div>
        <div className="rounded-full border border-ball/30 bg-ball/10 px-3 py-1.5 text-xs text-ball">
          {participants.length} {participants.length === 1 ? "entrant" : "entrants"}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.85fr]">
        <section className="glass-panel p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-bold text-white">Eligible players</h2>
            <span className="text-xs uppercase tracking-[0.16em] text-white/40">Live list</span>
          </div>
          {participants.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {participants.map((participant) => (
                <div key={participant.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 font-display text-white">
                  {participant.name}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-white/40">
              Players appear here when they are assigned to a court.
            </div>
          )}
        </section>

        <section className="glass-panel flex min-h-[360px] flex-col p-6">
          <div className="text-[10px] uppercase tracking-[0.25em] text-ball/80">Prize draw</div>
          <RaffleWheel names={participants.map((participant) => participant.name)} rotation={wheelRotation} spinning={spinning} />
          {canSpin && (
            <form onSubmit={spin} className="mt-4 space-y-3">
              <label className="field-label" htmlFor="raffle-prize">Prize description</label>
              <input
                id="raffle-prize"
                className="field"
                value={prizeDescription}
                onChange={(event) => setPrizeDescription(event.target.value)}
                placeholder="e.g. Dinner for two"
                maxLength={160}
                required
                disabled={spinning}
              />
              <button className="action-button w-full" disabled={spinning || participants.length === 0}>
                {spinning ? "Drawing winner..." : "Spin raffle wheel"}
              </button>
            </form>
          )}
          {!canSpin && <p className="mt-4 text-sm text-white/50">The tournament administrator controls the raffle draw.</p>}
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

          <div className="mt-auto pt-8 text-center">
            <div className="text-xs uppercase tracking-[0.22em] text-white/40">{spinning ? "And the winner is..." : latestDraw ? latestDraw.prizeDescription : "No draw yet"}</div>
            <div className={`mt-3 font-display text-3xl font-bold ${spinning ? "animate-pulse text-ball" : "text-white"}`}>
              {spinning ? spinningName || "..." : latestDraw?.winnerName || "Waiting for the first draw"}
            </div>
            {latestDraw && !spinning && <div className="mt-2 text-xs text-white/35">Drawn {new Date(latestDraw.createdAt).toLocaleString()}</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function RaffleWheel({ names, rotation, spinning }: { names: string[]; rotation: number; spinning: boolean }) {
  const wheelNames = names;
  const segmentSize = wheelNames.length > 0 ? 360 / wheelNames.length : 360;
  const segmentColors = wheelNames.map((_, index) => `${index % 2 === 0 ? "#f2c94c" : "#1e8f6b"} ${index * segmentSize}deg ${(index + 1) * segmentSize}deg`).join(", ");

  return (
    <div className="raffle-wheel-stage" aria-label={spinning ? "Raffle wheel is spinning" : "Raffle wheel"}>
      <div className="raffle-wheel-pointer" aria-hidden="true" />
      <div
        className={`raffle-wheel ${spinning ? "raffle-wheel-spinning" : ""}`}
        style={{
          transform: `rotate(${rotation}deg)`,
          background: wheelNames.length > 0 ? `conic-gradient(${segmentColors})` : "conic-gradient(#263d35 0deg 360deg)",
        }}
      >
        <div className="raffle-wheel-center">{spinning ? "DRAW" : "RAFFLE"}</div>
        {wheelNames.map((name, index) => {
          const angle = index * segmentSize + segmentSize / 2;
          return (
            <span
              key={`${name}-${index}`}
              className="raffle-wheel-label"
              style={{ transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-112px) rotate(${-angle}deg)` }}
            >
              {name}
            </span>
          );
        })}
      </div>
      {wheelNames.length === 0 && <span className="absolute text-xs uppercase tracking-[0.16em] text-white/40">Waiting for players</span>}
    </div>
  );
}