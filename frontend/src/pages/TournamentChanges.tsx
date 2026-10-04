import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useTournamentSocket } from "../lib/socket";
import TournamentViewsNav from "../components/TournamentViewsNav";

type TournamentChange = {
  id: string;
  action: string;
  createdAt: string;
  details: Record<string, unknown> | null;
  actor: { username: string } | null;
};

export default function TournamentChanges() {
  const { tournamentId } = useParams();
  const [changes, setChanges] = useState<TournamentChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!tournamentId) return;
    api.get<TournamentChange[]>(`/tournaments/${tournamentId}/changes`)
      .then(({ data }) => { setChanges(data); setError(null); })
      .catch((requestError) => setError(requestError?.response?.data?.error || "Couldn't load tournament changes."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tournamentId]);
  useTournamentSocket(tournamentId, ["bracket:changed", "games:changed", "tournament:changed"], load);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      {tournamentId && <TournamentViewsNav tournamentId={tournamentId} />}
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-ball/80">Tournament activity</p>
          <h1 className="mt-1 font-display text-3xl font-bold text-white">Changes</h1>
          <p className="mt-2 text-sm text-white/55">Bracket and result updates, with the account that made each change.</p>
        </div>
        <Link to={`/t/${tournamentId}/bracket`} className="secondary-button px-3 py-2 text-sm">Back to bracket</Link>
      </header>

      {error && <div role="alert" className="rounded-lg border border-red-300/20 bg-red-400/5 p-4 text-sm text-red-200">{error}</div>}
      {loading && <p className="text-sm text-white/50">Loading changes…</p>}
      {!loading && !error && changes.length === 0 && <p className="border-y border-white/10 py-6 text-sm text-white/50">No changes recorded yet.</p>}
      {!error && changes.length > 0 && <ol className="divide-y divide-white/10 border-y border-white/10">
        {changes.map((change) => <li key={change.id} className="flex gap-3 py-4">
          <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ball" />
          <div className="min-w-0 flex-1">
            <div className="font-display font-semibold text-white">{actionLabel(change.action)}</div>
            <p className="mt-1 text-sm text-white/65">{summaryFor(change)}</p>
            <p className="mt-2 text-xs text-white/40">{change.actor?.username ? `@${change.actor.username}` : "System"} · {new Date(change.createdAt).toLocaleString()}</p>
          </div>
        </li>)}
      </ol>}
    </div>
  );
}

function summaryFor(change: TournamentChange) {
  const summary = change.details?.summary;
  if (typeof summary === "string") return summary;
  const reason = change.details?.reason;
  return typeof reason === "string" ? reason : "Tournament information was updated.";
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    BRACKET_CREATED: "Bracket created",
    BRACKET_GENERATED: "Bracket generated",
    BRACKET_SLOT_FILLED: "Player added to bracket",
    BRACKET_SLOT_CLEARED: "Bracket slot cleared",
    BRACKET_BYES_LOCKED: "Byes advanced",
    BRACKET_PLAYER_SUBSTITUTED: "Player change",
    GAME_RESULT_CORRECTED: "Game result corrected",
    TOURNAMENT_FINALIZED: "Results finalized",
  };
  return labels[action] ?? action.replace(/_/g, " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}
