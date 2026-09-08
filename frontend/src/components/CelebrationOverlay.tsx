import { useEffect, useState } from "react";
import { RaffleDraw } from "../lib/api";
import { useTournamentSocket } from "../lib/socket";

type Celebration = { draw: RaffleDraw };

export default function CelebrationOverlay({ tournamentId }: { tournamentId: string | undefined }) {
  const [celebration, setCelebration] = useState<Celebration | null>(null);

  useTournamentSocket(tournamentId, ["raffle:won"], (payload) => {
    const next = payload as Celebration | undefined;
    if (next?.draw?.winnerName) setCelebration(next);
  });

  useEffect(() => {
    if (!celebration) return;
    const timeout = window.setTimeout(() => setCelebration(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [celebration]);

  if (!celebration) return null;
  const { draw } = celebration;

  return (
    <div className="celebration-overlay" role="status" aria-live="assertive">
      <div className="celebration-confetti" aria-hidden="true">
        {Array.from({ length: 36 }, (_, index) => <i key={index} style={{ "--i": index } as React.CSSProperties} />)}
      </div>
      <div className="celebration-card">
        <div className="text-[10px] uppercase tracking-[0.3em] text-ball">Winner</div>
        <div className="mt-3 text-5xl" aria-hidden="true">🏆</div>
        <h2 className="mt-3 font-display text-4xl font-bold text-white">{draw.winnerName}</h2>
        <div className="mt-4 text-xs uppercase tracking-[0.2em] text-white/45">Prize</div>
        <p className="mt-2 text-lg font-semibold text-ball">{draw.prizeDescription}</p>
        <p className="mt-5 text-xs uppercase tracking-[0.16em] text-white/40">Congratulations!</p>
      </div>
    </div>
  );
}