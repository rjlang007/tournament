import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, Player, SkillLevel } from "../lib/api";
import { useTournamentSocket } from "../lib/socket";
import { useAuth } from "../context/AuthContext";

const LEVELS: SkillLevel[] = ["BEGINNER", "AVERAGE", "ADVANCE"];

export default function Registration() {
  const { user } = useAuth();
  const { tournamentId } = useParams();
  const [players, setPlayers] = useState<Player[]>([]);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [skillLevel, setSkillLevel] = useState<SkillLevel>("BEGINNER");

  const load = () => api.get("/players", { params: { tournamentId } }).then((r) => setPlayers(r.data));
  useEffect(() => { load(); }, [tournamentId]);
  useTournamentSocket(tournamentId, ["players:changed"], load);

  const register = async () => {
    if (!name.trim()) return;
    await api.post("/players", { tournamentId, name, contact, skillLevel });
    setName(""); setContact("");
  };

  const updateStatus = async (id: string, status: string) => {
    await api.patch(`/players/${id}`, { status });
  };

  const updateSkill = async (id: string, level: SkillLevel) => {
    await api.patch(`/players/${id}`, { skillLevel: level });
  };

  const updateApproval = async (id: string, joinStatus: "APPROVED" | "REJECTED") => {
    await api.patch(`/players/${id}/approval`, { joinStatus });
  };

  const removePlayer = async (id: string) => {
    if (!window.confirm("Permanently remove this player from the tournament roster? Their roster record and active queue/bracket entries will be deleted.")) return;
    await api.patch(`/players/${id}/remove`);
    load();
  };

  const updateName = async (id: string, name: string) => {
    if (name.trim()) await api.patch(`/players/${id}`, { name: name.trim() });
  };

  const statusTone: Record<string, string> = {
    WAITING: "text-white/60",
    LEFT: "text-red-300",
    PLAYING: "text-ball",
    READY: "text-emerald-300",
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-white/45">Tournament management</div>
          <h2 className="mt-2 font-display text-3xl font-bold text-white">Player Registration</h2>
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-white/60">
          {players.length} registered
        </div>
      </header>

      {(user?.role === "ADMIN" || user?.role === "SUPERADMIN") && <section className="glass-panel p-4 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr_0.7fr_auto] lg:items-end">
          <div>
            <label className="field-label">Full name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Player name" className="field" />
          </div>
          <div>
            <label className="field-label">Contact</label>
            <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Optional" className="field" />
          </div>
          <div>
            <label className="field-label">Skill level</label>
            <select value={skillLevel} onChange={(e) => setSkillLevel(e.target.value as SkillLevel)} className="field">
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <button onClick={register} className="action-button w-full lg:w-auto">Register</button>
        </div>
      </section>}

      <section className="glass-panel p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-display text-xl font-bold text-white">Player list</h3>
          <div className="text-xs uppercase tracking-[0.2em] text-white/40">Live roster</div>
        </div>

        <div className="space-y-2">
          {players.map((p) => (
            <div key={p.id} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:flex-row sm:items-center">
              <div className="flex flex-1 items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ball/10 text-sm font-semibold text-ball ring-1 ring-ball/20">
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <input className="field max-w-[220px] py-1" defaultValue={p.name} onBlur={(event) => updateName(p.id, event.target.value)} />
                  <div className="text-xs text-white/45">{p.contact || "No contact provided"}</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                {user?.role === "ADMIN" || user?.role === "SUPERADMIN" ? <select
                  value={p.skillLevel}
                  onChange={(e) => updateSkill(p.id, e.target.value as SkillLevel)}
                  className={`skill-badge-${p.skillLevel} rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em]`}
                >
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select> : <span className={`skill-badge-${p.skillLevel} rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em]`}>{p.skillLevel}</span>}

                <span className={`min-w-[76px] text-center text-xs uppercase tracking-[0.12em] ${statusTone[p.status] ?? "text-white/60"}`}>
                  {p.status}
                </span>

                {p.joinStatus === "PENDING" && <>
                  <button onClick={() => updateApproval(p.id, "APPROVED")} className="secondary-button px-3 py-2 text-xs text-emerald-300">Approve</button>
                  <button onClick={() => updateApproval(p.id, "REJECTED")} className="secondary-button px-3 py-2 text-xs text-red-300">Reject</button>
                </>}
                {p.joinStatus === "REJECTED" && <span className="text-xs uppercase tracking-[0.12em] text-red-300">Rejected</span>}

                {(user?.role === "ADMIN" || user?.role === "SUPERADMIN") && (p.status !== "LEFT" ? (
                  <button onClick={() => updateStatus(p.id, "LEFT")} className="secondary-button px-3 py-2 text-xs uppercase tracking-[0.14em] text-red-300 hover:text-red-200">
                    Mark left
                  </button>
                ) : (
                  <button onClick={() => updateStatus(p.id, "WAITING")} className="secondary-button px-3 py-2 text-xs uppercase tracking-[0.14em] text-emerald-300 hover:text-emerald-200">
                    Re-add
                  </button>
                ))}
                {(user?.role === "ADMIN" || user?.role === "SUPERADMIN") && <button onClick={() => removePlayer(p.id)} className="secondary-button px-3 py-2 text-xs text-red-300">Remove</button>}
              </div>
            </div>
          ))}

          {players.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center text-sm text-white/45">
              No players registered yet. Add the first competitor to start the event.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
