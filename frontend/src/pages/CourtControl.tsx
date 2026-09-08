import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, Court, FinalizeCheck, Game, Player, Tournament, TieGroup } from "../lib/api";
import { useTournamentSocket } from "../lib/socket";
import SpinWheel from "../components/SpinWheel";
import TournamentLocationMap from "../components/TournamentLocationMap";

function fmt(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// Formats a Date for a <input type="datetime-local"> value in local time.
function toLocalInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fmtClock(iso?: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function useCountdown(scheduledEnd?: string | null) {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!scheduledEnd) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(Math.max(0, new Date(scheduledEnd).getTime() - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [scheduledEnd]);
  return remaining;
}

export default function CourtControl() {
  const { tournamentId } = useParams();
  const [courts, setCourts] = useState<Court[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [newCourtLabel, setNewCourtLabel] = useState("");
  const [drawnGames, setDrawnGames] = useState<Game[] | null>(null);
  const [upNext, setUpNext] = useState<Game[]>([]);
  const [queueEntries, setQueueEntries] = useState<Array<{ id: string; playerId: string; player: { id: string; name: string; skillLevel: string } }>>([]);
  const [waitingCount, setWaitingCount] = useState(0);
  const [finishingGame, setFinishingGame] = useState<Game | null>(null);
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleEnd, setScheduleEnd] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [locationLatitude, setLocationLatitude] = useState<number | null>(null);
  const [locationLongitude, setLocationLongitude] = useState<number | null>(null);

  // Finalize flow: null = closed. Otherwise holds the preview from
  // /finalize/check (current standings + any podium ties) so the operator
  // can resolve ties before the results actually get locked in.
  const [finalizeCheck, setFinalizeCheck] = useState<FinalizeCheck | null>(null);
  const [resolvingTie, setResolvingTie] = useState<TieGroup | null>(null);
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const [finalizeBusy, setFinalizeBusy] = useState(false);

  const load = () => {
    api.get("/courts", { params: { tournamentId } }).then((r) => setCourts(r.data));
    api.get("/players", { params: { tournamentId } }).then((r) => setPlayers(r.data));
    api.get(`/games/board/${tournamentId}`).then((r) => {
      setUpNext(r.data.upNext);
      setWaitingCount(r.data.waitingCount);
    });
    api.get(`/queue/${tournamentId}`).then((r) => setQueueEntries(r.data));
    api.get(`/tournaments/${tournamentId}`).then((r) => {
      setTournament(r.data);
      setLocationName(r.data.locationName ?? "");
      setLocationAddress(r.data.locationAddress ?? "");
      setLocationLatitude(r.data.locationLatitude ?? null);
      setLocationLongitude(r.data.locationLongitude ?? null);
    });
  };
  useEffect(() => { load(); }, [tournamentId]);
  useTournamentSocket(
    tournamentId,
    ["courts:changed", "games:changed", "players:changed", "tournament:changed"],
    load
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      setCourts((currentCourts) => currentCourts.map((court) => ({
        ...court,
        games: court.games?.map((game) => (
          game.status === "IN_PROGRESS"
            ? { ...game, remainingSeconds: Math.max(0, game.remainingSeconds - 1) }
            : game
        )),
      })));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const remainingMs = useCountdown(tournament?.scheduledEnd);
  const isPastSchedule = remainingMs === 0;

  const addCourt = async () => {
    if (!newCourtLabel.trim()) return;
    await api.post("/courts", { tournamentId, label: newCourtLabel });
    setNewCourtLabel("");
  };

  const toggleCourt = async (court: Court) => {
    await api.patch(`/courts/${court.id}/toggle`, { isEnabled: !court.isEnabled });
  };

  const draw = async () => {
    const before = new Set(upNext.map((g) => g.id));
    await api.post(`/queue/${tournamentId}/draw`);
    const { data } = await api.get(`/games/board/${tournamentId}`);
    const freshlyDrawn = data.upNext.filter((g: Game) => !before.has(g.id));
    setDrawnGames(freshlyDrawn.length > 0 ? freshlyDrawn : data.upNext);
    setUpNext(data.upNext);
    setWaitingCount(data.waitingCount);
  };

  const gameAction = async (gameId: string, action: "start" | "pause" | "resume") => {
    await api.post(`/games/${gameId}/${action}`);
  };

  const confirmFinish = async (winningTeam: "A" | "B") => {
    if (!finishingGame) return;
    const finalScoreA = Number(scoreA);
    const finalScoreB = Number(scoreB);
    if (!Number.isInteger(finalScoreA) || !Number.isInteger(finalScoreB) || finalScoreA < 0 || finalScoreB < 0 || finalScoreA === finalScoreB) {
      window.alert("Enter two different final scores before recording the winner.");
      return;
    }
    if ((winningTeam === "A" && finalScoreA < finalScoreB) || (winningTeam === "B" && finalScoreB < finalScoreA)) {
      window.alert("The winning team must have the higher score.");
      return;
    }
    await api.post(`/games/${finishingGame.id}/finish`, { winningTeam, scoreA: finalScoreA, scoreB: finalScoreB });
    setFinishingGame(null);
    setScoreA("");
    setScoreB("");
  };

  const cancelGame = async (gameId: string) => {
    if (!window.confirm("Cancel this game? Its players will return to the waiting queue.")) return;
    await api.post(`/games/${gameId}/cancel`);
    load();
  };

  const setDuration = async (gameId: string, minutes: number) => {
    await api.patch(`/games/${gameId}/duration`, { durationSeconds: minutes * 60 });
  };

  const moveQueuePlayer = async (playerId: string, direction: -1 | 1) => {
    const nextOrder = [...queueEntries.map((entry) => entry.playerId)];
    const index = nextOrder.indexOf(playerId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= nextOrder.length) return;
    [nextOrder[index], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[index]];
    await api.patch(`/queue/${tournamentId}/reorder`, { playerIds: nextOrder });
    load();
  };

  const removeQueuePlayer = async (playerId: string) => {
    await api.delete(`/queue/${tournamentId}/player/${playerId}`);
    load();
  };

  const clearWaitingQueue = async () => {
    if (queueEntries.length === 0 || !window.confirm(`Remove all ${queueEntries.length} waiting players from the queue? Their records will remain in the roster.`)) return;
    await api.delete(`/queue/${tournamentId}`);
    load();
  };

  const replaceQueuePlayer = async (playerId: string, replacementPlayerId: string) => {
    if (!replacementPlayerId) return;
    await api.patch(`/queue/${tournamentId}/replace`, { playerId, replacementPlayerId });
    load();
  };

  const assignGameToCourt = async (gameId: string, courtId: string | null) => {
    await api.patch(`/games/${gameId}/court`, { courtId });
    load();
  };

  const substituteGamePlayer = async (gameId: string, outPlayerId: string, inPlayerId: string) => {
    if (!inPlayerId) return;
    await api.patch(`/games/${gameId}/substitute`, { outPlayerId, inPlayerId });
    load();
  };

  const removeGamePlayer = async (gameId: string, playerId: string) => {
    await api.delete(`/games/${gameId}/player/${playerId}`);
    load();
  };

  const openSchedule = () => {
    setScheduleStart(tournament?.scheduledStart ? toLocalInputValue(new Date(tournament.scheduledStart)) : "");
    setScheduleEnd(tournament?.scheduledEnd ? toLocalInputValue(new Date(tournament.scheduledEnd)) : "");
    setScheduleOpen(true);
  };

  const saveSchedule = async () => {
    await api.patch(`/tournaments/${tournamentId}/schedule`, {
      scheduledStart: scheduleStart ? new Date(scheduleStart).toISOString() : null,
      scheduledEnd: scheduleEnd ? new Date(scheduleEnd).toISOString() : null,
    });
    setScheduleOpen(false);
    load();
  };

  const saveLocation = async () => {
    await api.patch(`/tournaments/${tournamentId}/location`, {
      locationName,
      locationAddress,
      latitude: locationLatitude,
      longitude: locationLongitude,
    });
    load();
  };

  const extend = async (minutes: number) => {
    const base = remainingMs !== null && remainingMs > 0 && tournament?.scheduledEnd
      ? new Date(tournament.scheduledEnd)
      : new Date();
    const newEndTime = new Date(base.getTime() + minutes * 60000).toISOString();
    await api.post(`/tournaments/${tournamentId}/extend`, { newEndTime });
    load();
  };

  // Step 1: preview standings/ties before touching anything.
  const openFinalizeCheck = async () => {
    const { data } = await api.get(`/tournaments/${tournamentId}/finalize/check`);
    setFinalizeCheck(data);
  };

  const closeFinalize = () => {
    setFinalizeCheck(null);
    setResolvingTie(null);
    setManualOrder([]);
  };

  // Step 2a: operator confirms - stop everything and lock in standings
  // as computed (used both when there's no tie, and for "finalize anyway"
  // on a tie the operator doesn't want to bother resolving).
  const finalizeAnyway = async () => {
    setFinalizeBusy(true);
    try {
      await api.post(`/tournaments/${tournamentId}/finalize`);
      closeFinalize();
      load();
    } finally {
      setFinalizeBusy(false);
    }
  };

  // Step 2b: operator wants the tie replayed - creates a real game between
  // just the tied players. Tournament stays active/unfinalized so they can
  // run it from Court Control, then reopen Finalize once it's done.
  const playTiebreaker = async (group: TieGroup) => {
    setFinalizeBusy(true);
    try {
      await api.post(`/tournaments/${tournamentId}/finalize/tiebreak-game`, {
        playerIds: group.rows.map((r) => r.playerId),
      });
      closeFinalize();
      load();
    } finally {
      setFinalizeBusy(false);
    }
  };

  // Step 2c: operator manually ranks the tied players themselves.
  const startManualOrder = (group: TieGroup) => {
    setResolvingTie(group);
    setManualOrder(group.rows.map((r) => r.playerId));
  };

  const moveManualOrder = (playerId: string, dir: -1 | 1) => {
    setManualOrder((prev) => {
      const i = prev.indexOf(playerId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  // Sends just the tied group's player IDs, in the operator's chosen
  // order - the backend splices them back into their original standings
  // position and leaves everyone else's computed order untouched.
  const confirmManualOrder = async () => {
    setFinalizeBusy(true);
    try {
      await api.post(`/tournaments/${tournamentId}/finalize`, { manualOrder });
      closeFinalize();
      load();
    } finally {
      setFinalizeBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h2 className="font-display text-2xl font-bold">Court Control</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-white/50">{waitingCount} players waiting</span>
          <button onClick={draw} className="action-button w-full sm:w-auto">
            Spin / Bunot-Bunot Draw
          </button>
        </div>
      </div>

      {/* Tournament schedule panel */}
      <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-white/50 mb-1">Tournament window</div>
          {tournament?.scheduledStart || tournament?.scheduledEnd ? (
            <div className="text-sm">
              <span className="font-semibold">{fmtClock(tournament.scheduledStart) ?? "—"}</span>
              <span className="text-white/40 mx-2">→</span>
              <span className="font-semibold">{fmtClock(tournament.scheduledEnd) ?? "—"}</span>
              {tournament.resultsFinalizedAt ? (
                <span className="ml-3 text-xs text-red-400 uppercase tracking-wide">Results finalized</span>
              ) : remainingMs !== null ? (
                <span className="ml-3 text-xs text-ball">
                  {remainingMs > 0 ? `${fmt(Math.floor(remainingMs / 1000))} left` : "Time's up"}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="text-sm text-white/30">No schedule set - results won't auto-finalize.</div>
          )}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <button onClick={openSchedule} className="secondary-button flex-1 px-3 py-1.5 text-sm sm:flex-none">Set schedule</button>
          <button onClick={() => extend(30)} className="secondary-button flex-1 px-3 py-1.5 text-sm sm:flex-none">+30 min</button>
          <button onClick={() => extend(60)} className="secondary-button flex-1 px-3 py-1.5 text-sm sm:flex-none">+1 hr</button>
          <button onClick={openFinalizeCheck} className="flex-1 rounded-xl bg-red-500/80 px-3 py-1.5 text-sm font-semibold sm:flex-none">Finalize now</button>
        </div>
      </div>

      {scheduleOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setScheduleOpen(false)}>
          <div className="bg-neutral-950 border border-white/10 rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-bold mb-4">Tournament schedule</h3>
            <label className="text-xs uppercase tracking-wide text-white/50">Start</label>
            <input
              type="datetime-local"
              value={scheduleStart}
              onChange={(e) => setScheduleStart(e.target.value)}
              className="w-full mt-1 mb-4 bg-white/5 border border-white/10 rounded-lg px-3 py-2"
            />
            <label className="text-xs uppercase tracking-wide text-white/50">End (auto-finalize time)</label>
            <input
              type="datetime-local"
              value={scheduleEnd}
              onChange={(e) => setScheduleEnd(e.target.value)}
              className="w-full mt-1 mb-6 bg-white/5 border border-white/10 rounded-lg px-3 py-2"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setScheduleOpen(false)} className="px-4 py-2 rounded-lg text-sm text-white/60">Cancel</button>
              <button onClick={saveSchedule} className="bg-ball text-neutral-900 font-display font-bold rounded-lg px-4 py-2 text-sm">Save</button>
            </div>
          </div>
        </div>
      )}

      <section className="mb-6 glass-panel p-4 sm:p-5">
        <div className="mb-4">
          <div className="text-xs uppercase tracking-[0.2em] text-white/50">Tournament venue</div>
          <h3 className="mt-1 font-display text-xl font-bold text-white">Set the playing location</h3>
          <p className="mt-1 text-sm text-white/50">Only tournament administrators can edit this venue. Click the map to place the pin.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-3">
            <div><label className="field-label">Venue name</label><input className="field" value={locationName} onChange={(event) => setLocationName(event.target.value)} placeholder="e.g. Riverside Sports Center" /></div>
            <div><label className="field-label">Address</label><textarea className="field min-h-24" value={locationAddress} onChange={(event) => setLocationAddress(event.target.value)} placeholder="Street, city, province" /></div>
            <div className="text-xs text-white/40">
              {locationLatitude !== null && locationLongitude !== null ? `Pinned at ${locationLatitude.toFixed(5)}, ${locationLongitude.toFixed(5)}` : "No map pin selected yet."}
            </div>
            <button onClick={saveLocation} className="action-button w-full sm:w-auto">Save venue</button>
          </div>
          <TournamentLocationMap
            latitude={locationLatitude}
            longitude={locationLongitude}
            editable
            onChange={(latitude, longitude) => { setLocationLatitude(latitude); setLocationLongitude(longitude); }}
          />
        </div>
      </section>

      {finalizeCheck && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={closeFinalize}>
          <div
            className="bg-neutral-950 border border-white/10 rounded-2xl p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            {!resolvingTie ? (
              <>
                <h3 className="font-display text-lg font-bold mb-1">
                  {finalizeCheck.ties.length > 0 ? "There's a tie for the podium" : "Finalize results?"}
                </h3>
                <p className="text-xs text-white/40 mb-4">
                  This stops the tournament and locks in the official standings. Exact final ties remain shared placements; no manual ordering is used.
                </p>

                {finalizeCheck.unfinishedGames > 0 && (
                  <div className="mb-4 rounded-xl border border-orange-300/30 bg-orange-400/10 p-3 text-sm text-orange-200">
                    {finalizeCheck.unfinishedGames} game{finalizeCheck.unfinishedGames === 1 ? "" : "s"} still need{finalizeCheck.unfinishedGames === 1 ? "s" : ""} to be finished or cancelled.
                  </div>
                )}

                {finalizeCheck.ties.map((group) => (
                  <div key={group.rank} className="rounded-xl border border-white/10 bg-white/5 p-3 mb-3">
                    <div className="text-xs uppercase tracking-wide text-white/50 mb-2">
                      Tied for {group.rank === 1 ? "1st" : group.rank === 2 ? "2nd" : "3rd"} place
                    </div>
                    <div className="text-sm mb-3">
                      {group.rows.map((r) => (
                        <div key={r.playerId} className="flex justify-between py-0.5">
                          <span className="font-semibold">{r.name}</span>
                          <span className="text-white/40">{r.wins}W - {r.losses}L</span>
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-white/45">The final phase already distributed these players across balanced games. If their final metrics remain identical, they share the placement.</div>
                  </div>
                ))}

                <div className="flex justify-between items-center mt-4">
                  <button onClick={closeFinalize} className="text-xs text-white/40 hover:text-white/70">
                    Cancel
                  </button>
                  <button
                    disabled={finalizeBusy || finalizeCheck.unfinishedGames > 0}
                    onClick={finalizeAnyway}
                    className="bg-red-500/80 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    Finalize results
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-display text-lg font-bold mb-1">Set the order</h3>
                <p className="text-xs text-white/40 mb-4">
                  Arrange these tied players from highest to lowest. Everyone else's ranking stays
                  as computed.
                </p>
                {finalizeCheck.unfinishedGames > 0 && (
                  <p className="mb-4 text-xs text-orange-200">
                    Finish or cancel the {finalizeCheck.unfinishedGames} remaining game{finalizeCheck.unfinishedGames === 1 ? "" : "s"} before confirming the final order.
                  </p>
                )}
                <div className="mb-4">
                  {manualOrder.map((playerId, i) => {
                    const row = resolvingTie.rows.find((r) => r.playerId === playerId)!;
                    return (
                      <div
                        key={playerId}
                        className="flex items-center justify-between gap-2 py-1.5 border-b border-white/5 last:border-0"
                      >
                        <span className="text-sm">
                          <span className="text-white/30 mr-2">{resolvingTie.rank + i}.</span>
                          {row.name}
                        </span>
                        <div className="flex gap-1">
                          <button
                            disabled={i === 0}
                            onClick={() => moveManualOrder(playerId, -1)}
                            className="w-6 h-6 rounded bg-white/10 text-xs disabled:opacity-20"
                          >
                            ↑
                          </button>
                          <button
                            disabled={i === manualOrder.length - 1}
                            onClick={() => moveManualOrder(playerId, 1)}
                            className="w-6 h-6 rounded bg-white/10 text-xs disabled:opacity-20"
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between items-center">
                  <button
                    onClick={() => { setResolvingTie(null); setManualOrder([]); }}
                    className="text-xs text-white/40 hover:text-white/70"
                  >
                    Back
                  </button>
                  <button
                    disabled={finalizeBusy || finalizeCheck.unfinishedGames > 0}
                    onClick={confirmManualOrder}
                    className="bg-ball text-neutral-900 font-display font-bold rounded-lg px-4 py-2 text-sm disabled:opacity-50"
                  >
                    Confirm order &amp; finalize
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {finishingGame && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setFinishingGame(null)}>
          <div className="bg-neutral-950 border border-white/10 rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-bold mb-1">Who won?</h3>
            <p className="text-xs text-white/40 mb-4">Enter the final score so standings can separate equal win records fairly.</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <label className="text-xs text-white/50">Team A score<input type="number" min="0" value={scoreA} onChange={(event) => setScoreA(event.target.value)} className="field mt-1" /></label>
              <label className="text-xs text-white/50">Team B score<input type="number" min="0" value={scoreB} onChange={(event) => setScoreB(event.target.value)} className="field mt-1" /></label>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <button
                onClick={() => confirmFinish("A")}
                className="rounded-xl border border-white/10 bg-white/5 hover:bg-ball/10 hover:border-ball p-4 text-left"
              >
                <div className="text-xs text-white/40 mb-1">Team A</div>
                <TeamNames game={finishingGame} team="A" />
              </button>
              <button
                onClick={() => confirmFinish("B")}
                className="rounded-xl border border-white/10 bg-white/5 hover:bg-ball/10 hover:border-ball p-4 text-left"
              >
                <div className="text-xs text-white/40 mb-1">Team B</div>
                <TeamNames game={finishingGame} team="B" />
              </button>
            </div>
            <div className="flex justify-end items-center">
              <button onClick={() => setFinishingGame(null)} className="text-xs text-white/40 hover:text-white/70">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {drawnGames && (
        <div className="mb-6">
          <SpinWheel games={drawnGames} allNames={players.map((p) => p.name)} onDone={() => {}} />
          <button onClick={() => setDrawnGames(null)} className="mt-2 text-xs text-white/40 hover:text-white/70">Close</button>
        </div>
      )}

      <div className="flex gap-2 mb-6">
        <input
          value={newCourtLabel}
          onChange={(e) => setNewCourtLabel(e.target.value)}
          placeholder="Court label e.g. Court 3"
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2"
        />
        <button onClick={addCourt} className="bg-white/10 rounded-lg px-4 py-2 text-sm">+ Add court</button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {courts.map((court) => {
          const game = court.games?.[0];
          return (
            <div key={court.id} className={`rounded-2xl border p-4 ${court.isEnabled ? "border-white/10 bg-white/5" : "border-white/5 bg-white/[0.02] opacity-50"}`}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-display text-lg font-bold">{court.label}</span>
                <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer">
                  {court.isEnabled ? "Enabled" : "Disabled"}
                  <input type="checkbox" checked={court.isEnabled} onChange={() => toggleCourt(court)} />
                </label>
              </div>

              {!game && <p className="text-white/30 text-sm py-6 text-center">No game assigned</p>}

              {game && (
                <div>
                  {game.isTiebreaker && (
                    <div className="text-[10px] uppercase tracking-wide text-ball font-bold mb-1">
                      🏆 Tiebreaker
                    </div>
                  )}
                  <div className="flex justify-between text-sm mb-2">
                    <EditableTeamNames game={game} team="A" players={players} onReplace={substituteGamePlayer} onRemove={removeGamePlayer} />
                    <span className="text-ball font-bold self-center">VS</span>
                    <EditableTeamNames game={game} team="B" players={players} onReplace={substituteGamePlayer} onRemove={removeGamePlayer} />
                  </div>
                  <div className="text-center my-3">
                    <div className="font-display text-4xl tabular-nums">{fmt(game.remainingSeconds)}</div>
                    <div className="text-xs text-white/40 uppercase tracking-wide">{game.status}</div>
                  </div>
                  <div className="flex gap-2 justify-center flex-wrap">
                    {game.status === "READY" && (
                      <button onClick={() => gameAction(game.id, "start")} className="bg-green-500/80 rounded-lg px-3 py-1.5 text-sm font-semibold">Start</button>
                    )}
                    {game.status === "IN_PROGRESS" && (
                      <>
                        <button onClick={() => gameAction(game.id, "pause")} className="bg-yellow-500/80 rounded-lg px-3 py-1.5 text-sm font-semibold">Pause</button>
                        <button onClick={() => setFinishingGame(game)} className="bg-red-500/80 rounded-lg px-3 py-1.5 text-sm font-semibold">Finish</button>
                      </>
                    )}
                    {game.status === "PAUSED" && (
                      <>
                        <button onClick={() => gameAction(game.id, "resume")} className="bg-green-500/80 rounded-lg px-3 py-1.5 text-sm font-semibold">Resume</button>
                        <button onClick={() => setFinishingGame(game)} className="bg-red-500/80 rounded-lg px-3 py-1.5 text-sm font-semibold">Finish</button>
                      </>
                    )}
                    {game.status !== "FINISHED" && game.status !== "CANCELLED" && (
                      <button onClick={() => cancelGame(game.id)} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/60 hover:text-white">
                        Cancel game
                      </button>
                    )}
                    <select
                      defaultValue={String(game.durationSeconds / 60)}
                      onChange={(e) => setDuration(game.id, Number(e.target.value))}
                      className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm"
                    >
                      {[15, 20, 25, 30].map((m) => <option key={m} value={m}>{m} min</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div>
          <h3 className="mb-3 font-display text-lg font-bold">Up Next · 3 lineups</h3>
          <div className="space-y-2">
            {upNext.slice(0, 3).map((g) => (
              <div key={g.id} className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-3">
                  {g.isTiebreaker && <span className="text-[10px] text-ball font-bold">🏆</span>}
                  <EditableTeamNames game={g} team="A" players={players} onReplace={substituteGamePlayer} onRemove={removeGamePlayer} />
                  <span className="text-ball font-bold">VS</span>
                  <EditableTeamNames game={g} team="B" players={players} onReplace={substituteGamePlayer} onRemove={removeGamePlayer} />
                </div>
                <select
                  value={g.courtId ?? ""}
                  onChange={(e) => assignGameToCourt(g.id, e.target.value || null)}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white/80"
                >
                  <option value="">Unassigned</option>
                  {courts.map((court) => (
                    <option key={court.id} value={court.id}>{court.label}</option>
                  ))}
                </select>
                <button type="button" onClick={() => cancelGame(g.id)} className="rounded-lg border border-white/15 px-2 py-1.5 text-xs text-white/55 hover:text-white">
                  Cancel
                </button>
              </div>
            ))}
            {upNext.length < 3 && [0, 1, 2].slice(upNext.length).map((index) => <div key={`empty-up-next-${index}`} className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-3 text-center text-xs uppercase tracking-[0.14em] text-white/30">Lineup {index + 1} awaiting eligible players</div>)}
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="font-display text-lg font-bold">Waiting Queue</h3>
            <div className="flex items-center gap-2"><span className="text-xs uppercase tracking-[0.18em] text-white/45">{queueEntries.length} players</span><button type="button" onClick={clearWaitingQueue} disabled={queueEntries.length === 0} className="rounded-md border border-red-400/30 px-2 py-1 text-[10px] uppercase tracking-wide text-red-300 disabled:opacity-30">Remove all</button></div>
          </div>
          <div className="space-y-2">
            {queueEntries.map((entry, index) => (
              <div key={entry.id} className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ball/10 text-[10px] font-bold text-ball">{index + 1}</span>
                  <span className="text-sm text-white/80">{entry.player.name}</span>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => moveQueuePlayer(entry.playerId, -1)}
                    disabled={index === 0}
                    className="h-7 w-7 rounded-md bg-white/[0.04] text-xs text-white/80 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveQueuePlayer(entry.playerId, 1)}
                    disabled={index === queueEntries.length - 1}
                    className="h-7 w-7 rounded-md bg-white/[0.04] text-xs text-white/80 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <select defaultValue="" onChange={(event) => replaceQueuePlayer(entry.playerId, event.target.value)} className="max-w-[120px] rounded-md bg-white/[0.04] px-1 text-[10px] text-white/80">
                    <option value="">Replace...</option>
                    {players.filter((player) => player.id !== entry.playerId && !queueEntries.some((queued) => queued.playerId === player.id) && player.joinStatus !== "REJECTED" && player.skillLevel === entry.player.skillLevel && ["WAITING", "LEFT"].includes(player.status)).map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
                  </select>
                  <button type="button" onClick={() => removeQueuePlayer(entry.playerId)} className="h-7 rounded-md bg-red-500/15 px-2 text-[10px] text-red-300">Remove</button>
                </div>
              </div>
            ))}
            {queueEntries.length === 0 && <p className="text-sm text-white/35">No players are currently waiting in the queue.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamNames({ game, team }: { game: Game; team: "A" | "B" }) {
  const teamPlayers = game.players.filter((p) => p.team === team);
  return <span className="flex flex-wrap items-center gap-2">{teamPlayers.length > 0 ? teamPlayers.map((p) => <PlayerLabel key={p.id} player={p.player} />) : "—"}</span>;
}

function PlayerLabel({ player }: { player: Player }) {
  return <span className="inline-flex flex-col leading-tight"><span>{player.name}</span><span className={`text-[9px] uppercase tracking-[0.12em] ${player.skillLevel === "ADVANCE" ? "text-red-300" : player.skillLevel === "AVERAGE" ? "text-orange-300" : "text-blue-300"}`}>{player.skillLevel}</span></span>;
}

function EditableTeamNames({
  game,
  team,
  players,
  onReplace,
  onRemove,
}: {
  game: Game;
  team: "A" | "B";
  players: Player[];
  onReplace: (gameId: string, outPlayerId: string, inPlayerId: string) => void;
  onRemove: (gameId: string, playerId: string) => void;
}) {
  const teamPlayers = game.players.filter((p) => p.team === team);
  return <span className="flex flex-wrap items-center gap-1">
    {teamPlayers.map((gamePlayer) => <span key={gamePlayer.id} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-1.5 py-1">
      <PlayerLabel player={gamePlayer.player} />
      <select defaultValue="" onChange={(event) => onReplace(game.id, gamePlayer.player.id, event.target.value)} className="max-w-[90px] bg-transparent text-[10px] text-white/70"><option value="">Replace</option>{players.filter((player) => player.id !== gamePlayer.player.id && !game.players.some((current) => current.player.id === player.id) && player.joinStatus !== "REJECTED" && player.skillLevel === gamePlayer.player.skillLevel && ["WAITING", "LEFT"].includes(player.status)).map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select>
      <button type="button" onClick={() => onRemove(game.id, gamePlayer.player.id)} className="text-[10px] text-red-300">Remove</button>
    </span>)}
  </span>;
}