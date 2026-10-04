import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, Player } from "../lib/api";
import { useTournamentSocket } from "../lib/socket";
import { useAuth } from "../context/AuthContext";
import TournamentViewsNav from "../components/TournamentViewsNav";

type BracketFormat = "SINGLE_ELIMINATION" | "DOUBLE_ELIMINATION" | "ROUND_ROBIN";

type BracketMatch = {
  id: string;
  bracketSide: "WINNERS" | "LOSERS" | "GRAND_FINAL" | "ROUND_ROBIN";
  round: number;
  slot: number;
  label?: string | null;
  entryAId?: string | null;
  entryBId?: string | null;
  winnerEntryId?: string | null;
  game?: {
    id: string;
    status: string;
    courtId?: string | null;
    winningTeam?: "A" | "B" | null;
    scoreA?: number | null;
    scoreB?: number | null;
  } | null;
};

type Court = { id: string; label: string; isEnabled: boolean; games?: { id: string; status: string }[] };

type Entry = { id: string; playerAId: string; playerBId?: string | null; teamName?: string | null };
type StandingRow = { entryId: string; name: string; wins: number; losses: number; played: number };

const FORMAT_LABELS: Record<BracketFormat, string> = {
  SINGLE_ELIMINATION: "Single Elimination",
  DOUBLE_ELIMINATION: "Double Elimination",
  ROUND_ROBIN: "Round Robin",
};

export default function BracketView() {
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "SUPERADMIN";
  const { tournamentId } = useParams();
  const [players, setPlayers] = useState<Player[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [bracketId, setBracketId] = useState<string | null>(null);
  const [format, setFormat] = useState<BracketFormat>("SINGLE_ELIMINATION");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [matches, setMatches] = useState<BracketMatch[]>([]);
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [generatedPlayerCount, setGeneratedPlayerCount] = useState<number | null>(null);
  const [draggedPlayerId, setDraggedPlayerId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    api.get("/players", { params: { tournamentId } }).then((r) => setPlayers(r.data));
    api.get("/courts", { params: { tournamentId } }).then((r) => setCourts(r.data));
    api.get(`/brackets/for-tournament/${tournamentId}`).then(({ data }) => {
      if (data) {
        setBracketId(data.id);
        setFormat(data.format);
      }
    });
  }, [tournamentId]);

  const loadMatches = () => {
    if (!bracketId) return;
    api.get(`/brackets/${bracketId}`).then((r) => setMatches(r.data));
    api.get(`/brackets/${bracketId}/entries`).then((r) => setEntries(r.data));
    api.get(`/brackets/${bracketId}/standings`).then((r) => setStandings(r.data));
  };
  useTournamentSocket(tournamentId, ["bracket:generated", "bracket:changed", "games:changed", "players:changed"], () => {
    loadMatches();
    api.get("/players", { params: { tournamentId } }).then((r) => setPlayers(r.data));
    api.get("/courts", { params: { tournamentId } }).then((r) => setCourts(r.data));
  });
  useEffect(loadMatches, [bracketId]);

  const createBracket = async () => {
    const { data } = await api.post("/brackets", { tournamentId, name: "Main Bracket", format });
    setBracketId(data.id);
  };

  const autoGenerate = async () => {
    if (!bracketId) return;
    if (matches.length > 0 && !window.confirm("This replaces the current bracket and clears any slots you've already filled. Continue?")) return;
    const { data } = await api.post(`/brackets/${bracketId}/auto-generate`, { format });
    setGeneratedPlayerCount(data.participantCount);
    loadMatches();
  };

  const lockByes = async () => {
    if (!bracketId) return;
    await api.post(`/brackets/${bracketId}/lock-byes`);
    loadMatches();
  };

  const startGame = async (matchId: string, courtId: string) => {
    await api.post(`/brackets/matches/${matchId}/start-game`, { courtId });
    loadMatches();
  };

  const fillSlot = async (matchId: string, slot: "A" | "B", playerId?: string, name?: string) => {
    if (!playerId && !name) return;
    if (playerId && usedPlayerIds.has(playerId)) {
      if (!window.confirm("That player is already placed elsewhere in this bracket. Add them again anyway?")) {
        setDraggedPlayerId(null);
        return;
      }
    }
    await api.patch(`/brackets/matches/${matchId}/slot`, { slot, playerId, name });
    setDraggedPlayerId(null);
    loadMatches();
  };

  const clearSlot = async (matchId: string, slot: "A" | "B") => {
    await api.delete(`/brackets/matches/${matchId}/slot`, { data: { slot } });
    loadMatches();
  };

  const replaceEntryPlayer = async (entryId: string, slot: "A" | "B", newPlayerId: string) => {
    const entry = entries.find((candidate) => candidate.id === entryId);
    if (!entry) return;
    const currentPlayerId = slot === "A" ? entry.playerAId : entry.playerBId;
    const currentName = players.find((player) => player.id === currentPlayerId)?.name ?? "Current player";
    const replacementName = players.find((player) => player.id === newPlayerId)?.name ?? "Selected player";
    const duplicateWarning = usedPlayerIds.has(newPlayerId) && newPlayerId !== entry.playerAId && newPlayerId !== entry.playerBId
      ? " This player is already placed elsewhere in the bracket."
      : "";
    if (!window.confirm(`Replace ${currentPlayerId ? currentName : "the open partner spot"} with ${replacementName} in upcoming matches?${duplicateWarning} Completed match results will stay unchanged.`)) return;
    setActionError(null);
    try {
      await api.patch(`/brackets/entries/${entryId}/substitute`, { slot, newPlayerId });
      loadMatches();
    } catch (error: any) {
      setActionError(error?.response?.data?.error || "Could not update this bracket entry.");
    }
  };

  const playerName = (id?: string | null) => players.find((p) => p.id === id)?.name ?? "Unknown";
  const entryOf = (entryId?: string | null) => entries.find((e) => e.id === entryId);
  const entryLabel = (entryId?: string | null) => {
    const entry = entryOf(entryId);
    if (!entry) return null;
    return entry.teamName || `${playerName(entry.playerAId)}${entry.playerBId ? " & " + playerName(entry.playerBId) : ""}`;
  };

  const usedPlayerIds = useMemo(() => {
    const ids = new Set<string>();
    entries.forEach((e) => {
      ids.add(e.playerAId);
      if (e.playerBId) ids.add(e.playerBId);
    });
    return ids;
  }, [entries]);

  const winners = matches.filter((m) => m.bracketSide === "WINNERS");
  const losers = matches.filter((m) => m.bracketSide === "LOSERS");
  const grandFinal = matches.find((m) => m.bracketSide === "GRAND_FINAL");
  const hasBracketGames = matches.some((match) => match.game);
  const availableCourts = courts.filter((court) => court.isEnabled && !court.games?.length);
  const winnersRounds = Array.from(new Set(winners.map((m) => m.round))).sort((a, b) => a - b);
  const losersRounds = Array.from(new Set(losers.map((m) => m.round))).sort((a, b) => a - b);
  const rrRounds = Array.from(new Set(matches.filter((m) => m.bracketSide === "ROUND_ROBIN").map((m) => m.round))).sort(
    (a, b) => a - b
  );

  const renderSlot = (match: BracketMatch, slot: "A" | "B") => {
    const entryId = slot === "A" ? match.entryAId : match.entryBId;
    const label = entryLabel(entryId);
    const isWinner = match.winnerEntryId && entryId === match.winnerEntryId;
    const entry = entryOf(entryId);

    if (label) {
      return (
        <div className={`flex items-center justify-between gap-2 py-1 ${isWinner ? "text-ball font-semibold" : ""}`}>
          <span className="truncate">{label}</span>
          <div className="flex items-center gap-1 shrink-0">
            {canEdit && entry && !match.winnerEntryId && !["FINISHED", "IN_PROGRESS", "PAUSED"].includes(match.game?.status ?? "") && (
              <div className="flex items-center gap-1">
                <select
                  value=""
                  onChange={(event) => event.target.value && replaceEntryPlayer(entry.id, "A", event.target.value)}
                  className="max-w-[84px] text-[10px] bg-white/5 border border-white/10 rounded px-1 py-0.5"
                  title="Replace first player"
                >
                  <option value="">Swap A</option>
                  {players.filter((player) => player.id !== entry.playerAId).map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
                </select>
                <select
                  value=""
                  onChange={(event) => event.target.value && replaceEntryPlayer(entry.id, "B", event.target.value)}
                  className="max-w-[84px] text-[10px] bg-white/5 border border-white/10 rounded px-1 py-0.5"
                  title={entry.playerBId ? "Replace second player" : "Add doubles partner"}
                >
                  <option value="">{entry.playerBId ? "Swap B" : "+ partner"}</option>
                  {players.filter((player) => player.id !== entry.playerAId && player.id !== entry.playerBId).map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
                </select>
              </div>
            )}
            {canEdit && !match.winnerEntryId && !["FINISHED", "IN_PROGRESS", "PAUSED"].includes(match.game?.status ?? "") && (
              <button onClick={() => clearSlot(match.id, slot)} className="text-white/30 hover:text-white/70 text-xs px-1">×</button>
            )}
          </div>
        </div>
      );
    }

    if (!canEdit) return <div className="py-1 text-xs text-white/30">TBD</div>;

    return (
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => draggedPlayerId && fillSlot(match.id, slot, draggedPlayerId)}
        className="py-1 border border-dashed border-white/15 rounded px-2 my-0.5"
      >
        <input
          type="text"
          list="bracket-roster-names"
          placeholder="Drag or type a name…"
          className="w-full bg-transparent text-xs placeholder-white/30 outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.currentTarget.value.trim()) {
              const typed = e.currentTarget.value.trim();
              const match2 = players.find((p) => p.name.toLowerCase() === typed.toLowerCase());
              fillSlot(match.id, slot, match2?.id, match2 ? undefined : typed);
              e.currentTarget.value = "";
            }
          }}
        />
      </div>
    );
  };

  const renderMatchAction = (match: BracketMatch) => {
    if (!match.entryAId || !match.entryBId) return null; // slots not both filled yet

    if (match.game?.status === "FINISHED") {
      const winnerId = match.game.winningTeam === "A" ? match.entryAId : match.entryBId;
      return (
        <div className="mt-2 pt-2 border-t border-white/10 text-[11px] text-white/60">
          Final: {match.game.scoreA}-{match.game.scoreB} · {entryLabel(winnerId)} won
        </div>
      );
    }
    if (match.winnerEntryId) return null; // already decided

    if (match.game && match.game.status !== "CANCELLED") {
      return (
        <div className="mt-2 pt-2 border-t border-white/10 text-[11px] text-white/50 flex items-center justify-between">
          <span>{match.game.status === "IN_PROGRESS" ? "In progress" : match.game.status === "PAUSED" ? "Paused" : "Ready to start"}</span>
          <a href={`/t/${tournamentId}/courts`} className="text-ball hover:underline">Go to Court Control →</a>
        </div>
      );
    }

    if (!canEdit) return null;

    return (
      <div className="mt-2 pt-2 border-t border-white/10">
        <select
          defaultValue=""
          onChange={(e) => e.target.value && startGame(match.id, e.target.value)}
          className="w-full text-[11px] bg-white/5 border border-white/10 rounded px-2 py-1"
        >
          <option value="" disabled>{match.game?.status === "CANCELLED" ? "Restart on court…" : "Start on court…"}</option>
          {courts.filter((court) => court.isEnabled).map((court) => (
            <option key={court.id} value={court.id} disabled={Boolean(court.games?.length)}>
              {court.label}{court.games?.length ? " (in use)" : ""}
            </option>
          ))}
        </select>
        {availableCourts.length === 0 && <div className="text-[10px] text-white/30 mt-1">No available courts. Enable a free court in Court Control.</div>}
        {match.game?.status === "CANCELLED" && <div className="text-[10px] text-white/40 mt-1">The cancelled match can be restarted.</div>}
      </div>
    );
  };

  const championLabel = (() => {
    const finalMatch = grandFinal ?? winners.find((m) => m.round === Math.max(0, ...winnersRounds));
    if (!finalMatch?.winnerEntryId) return null;
    return entryLabel(finalMatch.winnerEntryId);
  })();

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      {tournamentId && <TournamentViewsNav tournamentId={tournamentId} />}
      <h2 className="font-display text-2xl font-bold mb-4">Bracket</h2>
      {actionError && <p role="alert" className="mb-4 rounded-lg border border-red-300/20 bg-red-400/5 p-3 text-sm text-red-200">{actionError}</p>}
      <datalist id="bracket-roster-names">
        {players.map((p) => <option key={p.id} value={p.name} />)}
      </datalist>

      {!bracketId && canEdit && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 max-w-md">
          <label className="text-xs text-white/50 block mb-2">Bracket format</label>
          <div className="flex flex-col gap-2 mb-4">
            {(Object.keys(FORMAT_LABELS) as BracketFormat[]).map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm">
                <input type="radio" name="format" checked={format === f} onChange={() => setFormat(f)} />
                {FORMAT_LABELS[f]}
              </label>
            ))}
          </div>
          <button onClick={createBracket} className="bg-ball text-neutral-900 font-display font-bold rounded-lg px-4 py-2">
            Create Bracket
          </button>
        </div>
      )}

      {bracketId && canEdit && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
          <button onClick={autoGenerate} disabled={hasBracketGames} className="action-button w-full sm:w-auto disabled:opacity-40">
            Generate {FORMAT_LABELS[format]} From Registered Players
          </button>
          {generatedPlayerCount !== null && <span className="text-sm text-white/70">Generated for {generatedPlayerCount} players.</span>}
          {format !== "ROUND_ROBIN" && matches.length > 0 && (
            <button onClick={lockByes} className="secondary-button w-full text-sm sm:ml-auto sm:w-auto">
              Lock Byes / Advance
            </button>
          )}
          <span className="text-xs text-white/40 w-full">
            Uses every approved player who has not left. Regenerate before any games are created; the new schedule replaces the current one.
          </span>
        </div>
      )}

      {bracketId && format !== "ROUND_ROBIN" && (
        <>

          <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 h-fit">
              <div className="text-xs uppercase text-white/40 mb-2">Full Player List</div>
              <ul className="flex flex-col gap-1">
                {players.map((p) => (
                  <li
                    key={p.id}
                    draggable={canEdit}
                    onDragStart={() => canEdit && setDraggedPlayerId(p.id)}
                    onDragEnd={() => canEdit && setDraggedPlayerId(null)}
                    className={`text-xs rounded-full px-3 py-1 cursor-grab select-none border ${
                      usedPlayerIds.has(p.id)
                        ? "bg-white/5 border-white/5 text-white/30"
                        : "bg-white/10 border-white/10 hover:border-ball/50"
                    }`}
                  >
                    {p.name}
                  </li>
                ))}
                {players.length === 0 && <li className="text-white/30 text-xs">No players registered yet.</li>}
              </ul>
            </div>

            <div className="overflow-x-auto">
              {matches.length === 0 && <p className="text-white/30 text-sm">No bracket generated yet.</p>}

              {winnersRounds.length > 0 && (
                <>
                  <div className="text-xs uppercase text-white/40 mb-2">{format === "DOUBLE_ELIMINATION" ? "Winners Bracket" : "Bracket"}</div>
                  <div className="flex gap-8 mb-8">
                    {winnersRounds.map((round) => (
                      <div key={round} className="flex flex-col justify-around gap-4 min-w-[220px]">
                        <div className="text-xs uppercase text-white/40 text-center mb-1">
                          {winners.find((m) => m.round === round)?.label ?? `Round ${round}`}
                        </div>
                        {winners.filter((m) => m.round === round).map((m) => (
                          <div key={m.id} className="bg-white/5 border border-white/10 rounded-lg p-3 text-sm">
                            {renderSlot(m, "A")}
                            <div className="border-t border-white/10 my-1" />
                            {renderSlot(m, "B")}
                            {renderMatchAction(m)}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {format === "DOUBLE_ELIMINATION" && losersRounds.length > 0 && (
                <>
                  <div className="text-xs uppercase text-white/40 mb-2">Losers Bracket</div>
                  <div className="flex gap-8 mb-8">
                    {losersRounds.map((round) => (
                      <div key={round} className="flex flex-col justify-around gap-4 min-w-[220px]">
                        <div className="text-xs uppercase text-white/40 text-center mb-1">
                          {losers.find((m) => m.round === round)?.label ?? `Losers Round ${round}`}
                        </div>
                        {losers.filter((m) => m.round === round).map((m) => (
                          <div key={m.id} className="bg-white/5 border border-white/10 rounded-lg p-3 text-sm">
                            {renderSlot(m, "A")}
                            <div className="border-t border-white/10 my-1" />
                            {renderSlot(m, "B")}
                            {renderMatchAction(m)}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {grandFinal && (
                <>
                  <div className="text-xs uppercase text-white/40 mb-2">Grand Final</div>
                  <div className="bg-white/5 border border-ball/40 rounded-lg p-3 text-sm max-w-[240px]">
                    {renderSlot(grandFinal, "A")}
                    <div className="border-t border-white/10 my-1" />
                    {renderSlot(grandFinal, "B")}
                    {renderMatchAction(grandFinal)}
                  </div>
                </>
              )}

              {championLabel && (
                <div className="mt-6 bg-ball/10 border border-ball/40 rounded-xl p-4 text-center">
                  <div className="text-xs uppercase text-ball/70 tracking-wide">Champion</div>
                  <div className="font-display text-xl font-bold text-ball">{championLabel}</div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {bracketId && format === "ROUND_ROBIN" && (
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 h-fit">
            <div className="text-xs uppercase text-white/40 mb-2">Registered Players</div>
            <ul className="flex flex-col gap-1">
              {players.map((p) => (
                <li key={p.id} className="text-xs rounded-full px-3 py-1 border bg-white/10 border-white/10">{p.name}</li>
              ))}
              {players.length === 0 && <li className="text-white/30 text-xs">No players registered yet.</li>}
            </ul>
          </div>

          <div>
            {matches.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-white/45">The round-robin schedule has not been generated yet.</div>
            ) : (
              <>
                <div className="mb-8 overflow-x-auto">
                  <div className="text-xs uppercase text-white/40 mb-2">Schedule</div>
                  <div className="flex gap-6">
                    {rrRounds.map((round) => (
                      <div key={round} className="min-w-[200px]">
                        <div className="text-xs uppercase text-white/40 text-center mb-2">Round {round}</div>
                        <div className="flex flex-col gap-2">
                          {matches.filter((m) => m.bracketSide === "ROUND_ROBIN" && m.round === round).map((m) => (
                            <div key={m.id} className="bg-white/5 border border-white/10 rounded-lg p-2 text-xs">
                              <div>{entryLabel(m.entryAId)}</div>
                              <div className="text-white/30 text-center">vs</div>
                              <div>{entryLabel(m.entryBId)}</div>
                              {renderMatchAction(m)}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase text-white/40 mb-2">Standings</div>
                  <table className="text-sm w-full max-w-md">
                    <thead>
                      <tr className="text-white/40 text-xs text-left">
                        <th className="py-1">Player / Team</th>
                        <th className="py-1 text-right">W</th>
                        <th className="py-1 text-right">L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((row) => (
                        <tr key={row.entryId} className="border-t border-white/10">
                          <td className="py-1">{row.name}</td>
                          <td className="py-1 text-right">{row.wins}</td>
                          <td className="py-1 text-right">{row.losses}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
