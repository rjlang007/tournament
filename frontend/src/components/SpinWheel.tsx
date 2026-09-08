import { useEffect, useState } from "react";
import { Game } from "../lib/api";

/**
 * Plays a "bunot-bunot" reveal: rapidly cycles random names before landing
 * on each drawn game's actual pairing. Purely presentational - the real
 * randomization already happened server-side (skill-rule + shuffle); this
 * is the dramatic reveal moment for the crowd/kiosk.
 */
export default function SpinWheel({ games, allNames, onDone }: { games: Game[]; allNames: string[]; onDone?: () => void }) {
  const [revealedCount, setRevealedCount] = useState(0);
  const [spinningNames, setSpinningNames] = useState<string[]>(["", "", "", ""]);

  useEffect(() => {
    if (games.length === 0 || allNames.length === 0) return;
    if (revealedCount >= games.length) {
      onDone?.();
      return;
    }

    let ticks = 0;
    const interval = setInterval(() => {
      setSpinningNames([
        allNames[Math.floor(Math.random() * allNames.length)],
        allNames[Math.floor(Math.random() * allNames.length)],
        allNames[Math.floor(Math.random() * allNames.length)],
        allNames[Math.floor(Math.random() * allNames.length)],
      ]);
      ticks++;
      if (ticks > 14) {
        clearInterval(interval);
        setTimeout(() => setRevealedCount((c) => c + 1), 400);
      }
    }, 80);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealedCount, games.length]);

  const currentGame = games[revealedCount];
  const isSpinning = currentGame !== undefined;

  return (
    <div className="bg-court-bg rounded-2xl border-4 border-court-line/30 p-8 text-center">
      <div className="font-display text-ball text-sm uppercase tracking-[0.3em] mb-4">Bunot-Bunot Draw</div>
      {games.slice(0, revealedCount).map((g, i) => (
        <RevealedRow key={g.id ?? i} game={g} />
      ))}
      {isSpinning && (
        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto mt-4 animate-pulse">
          <NameSlot label="Team A" a={spinningNames[0]} b={spinningNames[1]} />
          <NameSlot label="Team B" a={spinningNames[2]} b={spinningNames[3]} />
        </div>
      )}
      {!isSpinning && games.length === 0 && (
        <p className="text-white/50 text-sm">No eligible pairings to draw right now.</p>
      )}
    </div>
  );
}

function NameSlot({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <div className="bg-black/30 rounded-xl p-4 border border-white/10">
      <div className="text-xs text-white/40 mb-1">{label}</div>
      <div className="font-display text-lg text-white">{a}</div>
      <div className="font-display text-lg text-white">{b}</div>
    </div>
  );
}

function RevealedRow({ game }: { game: Game }) {
  const teamA = game.players.filter((p) => p.team === "A");
  const teamB = game.players.filter((p) => p.team === "B");
  return (
    <div className="flex items-center justify-center gap-3 py-2 border-b border-white/10 last:border-0 animate-[fadeIn_0.4s_ease]">
      <span className="flex flex-wrap justify-center gap-2 font-display text-white">{teamA.map((p) => <span key={p.id} className="inline-flex flex-col leading-tight"><span>{p.player.name}</span><span className="text-[9px] uppercase tracking-[0.12em] text-white/45">{p.player.skillLevel}</span></span>)}</span>
      <span className="text-ball font-bold">VS</span>
      <span className="flex flex-wrap justify-center gap-2 font-display text-white">{teamB.map((p) => <span key={p.id} className="inline-flex flex-col leading-tight"><span>{p.player.name}</span><span className="text-[9px] uppercase tracking-[0.12em] text-white/45">{p.player.skillLevel}</span></span>)}</span>
    </div>
  );
}
