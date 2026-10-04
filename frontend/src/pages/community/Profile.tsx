import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, fileUrl, PublicProfile } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";

type DefaultAvatarOption = { key: string; url: string };

export default function Profile() {
  const { username } = useParams();
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [savingChanges, setSavingChanges] = useState(false);
  const [defaults, setDefaults] = useState<DefaultAvatarOption[] | null>(null);
  const [selectedAvatar, setSelectedAvatar] = useState<File | null>(null);
  const [selectedDefaultAvatarKey, setSelectedDefaultAvatarKey] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const isOwn = !!user && user.username === username;

  function load() {
    if (!username) return;
    api
      .get<PublicProfile>(`/users/${username}`)
      .then(({ data }) => {
        setProfile(data);
        setBio(data.bio);
      })
      .catch((err) => setError(err?.response?.data?.error || "User not found."));
  }

  useEffect(load, [username]);

  useEffect(() => {
    if (isOwn) {
      api.get<DefaultAvatarOption[]>("/users/default-avatars").then(({ data }) => setDefaults(data));
    }
  }, [isOwn]);

  useEffect(() => {
    if (!selectedAvatar) {
      setAvatarPreview(null);
      return;
    }
    const previewUrl = URL.createObjectURL(selectedAvatar);
    setAvatarPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [selectedAvatar]);

  const currentDefaultAvatarKey = defaults?.find((option) => fileUrl(option.url) === fileUrl(profile?.avatarUrl))?.key ?? null;
  const selectedDefaultAvatar = defaults?.find((option) => option.key === selectedDefaultAvatarKey);
  const hasChanges = !!profile && (bio !== profile.bio || !!selectedAvatar || (!!selectedDefaultAvatarKey && selectedDefaultAvatarKey !== currentDefaultAvatarKey));

  async function saveChanges() {
    if (!profile || !hasChanges) return;
    setSavingChanges(true);
    setSaveError(null);
    try {
      if (bio !== profile.bio) await api.patch("/users/me", { bio });
      if (selectedAvatar) {
        const form = new FormData();
        form.append("avatar", selectedAvatar);
        await api.post("/users/me/avatar", form, { headers: { "Content-Type": "multipart/form-data" } });
      } else if (selectedDefaultAvatarKey && selectedDefaultAvatarKey !== currentDefaultAvatarKey) {
        await api.post("/users/me/default-avatar", { key: selectedDefaultAvatarKey });
      }
      await refresh();
      navigate("/");
    } catch (err: any) {
      setSaveError(err?.response?.data?.error || "Couldn't save your profile changes. Please try again.");
    } finally {
      setSavingChanges(false);
    }
  }

  if (error) return <p className="text-advance">{error}</p>;
  if (!profile) return <p className="text-white/60">Loading…</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-4 mb-6">
        <img
          src={avatarPreview ?? (selectedDefaultAvatar ? fileUrl(selectedDefaultAvatar.url) : fileUrl(profile.avatarUrl))}
          alt=""
          className="w-24 h-24 rounded-full object-cover border-2 border-white/20"
        />
        <div>
          <h1 className="font-display text-2xl font-bold text-white">{profile.username}</h1>
          {profile.memberSince && (
            <p className="text-xs text-white/40">
              Member since {new Date(profile.memberSince).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>

      {profile.playerStats && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-ball">Career stats</p>
              <h2 className="mt-1 font-display text-xl font-bold text-white">Player performance</h2>
            </div>
            <Link to="/community/leaderboard" className="text-xs font-semibold text-white/50 hover:text-ball">View rankings →</Link>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Overall points" value={profile.playerStats.overallPoints} highlight />
            <StatCard label="Open play" value={profile.playerStats.openPlayPoints} />
            <StatCard label="Tournament" value={profile.playerStats.tournamentPoints} />
            <StatCard label="Win rate" value={`${profile.playerStats.winRate}%`} />
            <StatCard label="Wins" value={profile.playerStats.wins} />
            <StatCard label="Losses" value={profile.playerStats.losses} />
            <StatCard label="Games played" value={profile.playerStats.gamesPlayed} />
            <StatCard label="Podiums" value={profile.playerStats.podiums} />
          </div>
          <p className="mt-4 text-xs text-white/40">Played in {profile.playerStats.eventsPlayed} event{profile.playerStats.eventsPlayed === 1 ? "" : "s"}.</p>
        </section>
      )}

      {isOwn ? (
        <div className="space-y-6">
          <div>
            <label className="block text-sm text-white/70 mb-1">Your description</label>
            <textarea
              className="w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white outline-none focus:border-ball"
              rows={3}
              maxLength={500}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm text-white/70 mb-1">Upload a profile picture</label>
            <p className="text-xs text-white/40 mb-2">
              Uploaded profile pictures are kept permanently on the server - they're the one photo
              type that is never auto-deleted.
            </p>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              disabled={savingChanges}
              onChange={(e) => {
                setSelectedAvatar(e.target.files?.[0] ?? null);
                setSelectedDefaultAvatarKey(null);
              }}
              className="text-sm text-white/70"
            />
            {selectedAvatar && <p className="mt-1 text-xs text-white/45">Selected: {selectedAvatar.name}</p>}
          </div>

          <div>
            <label className="block text-sm text-white/70 mb-2">…or pick a default animal avatar</label>
            <div className="flex flex-wrap gap-2">
              {defaults?.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => {
                    setSelectedAvatar(null);
                    setSelectedDefaultAvatarKey(d.key === currentDefaultAvatarKey ? null : d.key);
                    if (avatarInputRef.current) avatarInputRef.current.value = "";
                  }}
                  disabled={savingChanges}
                  className={`w-14 h-14 rounded-full overflow-hidden border-2 hover:border-ball disabled:opacity-50 ${selectedDefaultAvatarKey === d.key || (!selectedDefaultAvatarKey && !selectedAvatar && currentDefaultAvatarKey === d.key) ? "border-ball" : "border-white/10"}`}
                  title={d.key}
                >
                  <img src={fileUrl(d.url)} alt={d.key} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>

          {saveError && <p role="alert" className="text-sm text-advance">{saveError}</p>}
          <div className="flex items-center gap-3 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={saveChanges}
              disabled={savingChanges || !hasChanges}
              className="rounded-lg bg-ball text-neutral-900 font-display font-semibold px-4 py-2 text-sm disabled:opacity-50"
            >
              {savingChanges ? "Saving…" : "Save changes"}
            </button>
            <Link to="/community" className="text-sm text-white/55 hover:text-white">Cancel</Link>
          </div>
        </div>
      ) : (
        <p className="text-white/80 whitespace-pre-wrap">{profile.bio || "No description yet."}</p>
      )}

      {isOwn && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-ball">Profile activity</p>
              <h2 className="mt-1 font-display text-xl font-bold text-white">Recent visitors</h2>
            </div>
            <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/55">{profile.visitors?.length ?? 0} visitors</span>
          </div>
          {profile.visitors?.length ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {profile.visitors.map((visitor) => (
                <Link key={visitor.id} to={`/community/profile/${encodeURIComponent(visitor.username)}`} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3 hover:border-ball/30">
                  <img src={fileUrl(visitor.avatarUrl)} alt="" className="h-10 w-10 rounded-full border border-white/10 object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{visitor.username}</p>
                    <p className="text-xs text-white/40">Visited {new Date(visitor.visitedAt).toLocaleString()}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : <p className="mt-4 text-sm text-white/45">Your visitors will appear here when they view your profile.</p>}
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, highlight = false }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/20 p-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-white/40">{label}</p>
      <p className={`mt-2 font-display text-xl font-bold ${highlight ? "text-ball" : "text-white"}`}>{value}</p>
    </div>
  );
}
