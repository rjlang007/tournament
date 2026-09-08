import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, fileUrl, PublicProfile } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";

type DefaultAvatarOption = { key: string; url: string };

export default function Profile() {
  const { username } = useParams();
  const { user, refresh } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [savingBio, setSavingBio] = useState(false);
  const [defaults, setDefaults] = useState<DefaultAvatarOption[] | null>(null);
  const [uploading, setUploading] = useState(false);

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

  async function saveBio() {
    setSavingBio(true);
    try {
      await api.patch("/users/me", { bio });
      load();
    } finally {
      setSavingBio(false);
    }
  }

  async function onUploadAvatar(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("avatar", file);
      await api.post("/users/me/avatar", form, { headers: { "Content-Type": "multipart/form-data" } });
      load();
      refresh();
    } finally {
      setUploading(false);
    }
  }

  async function onPickDefault(key: string) {
    await api.post("/users/me/default-avatar", { key });
    load();
    refresh();
  }

  if (error) return <p className="text-advance">{error}</p>;
  if (!profile) return <p className="text-white/60">Loading…</p>;

  return (
    <div className="max-w-xl">
      <div className="flex items-center gap-4 mb-6">
        <img
          src={fileUrl(profile.avatarUrl)}
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
            <button
              onClick={saveBio}
              disabled={savingBio}
              className="mt-2 rounded-lg bg-ball text-neutral-900 font-display font-semibold px-4 py-1.5 text-sm disabled:opacity-50"
            >
              {savingBio ? "Saving…" : "Save description"}
            </button>
          </div>

          <div>
            <label className="block text-sm text-white/70 mb-1">Upload a profile picture</label>
            <p className="text-xs text-white/40 mb-2">
              Uploaded profile pictures are kept permanently on the server - they're the one photo
              type that is never auto-deleted.
            </p>
            <input
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={(e) => e.target.files?.[0] && onUploadAvatar(e.target.files[0])}
              className="text-sm text-white/70"
            />
          </div>

          <div>
            <label className="block text-sm text-white/70 mb-2">…or pick a default animal avatar</label>
            <div className="flex flex-wrap gap-2">
              {defaults?.map((d) => (
                <button
                  key={d.key}
                  onClick={() => onPickDefault(d.key)}
                  className="w-14 h-14 rounded-full overflow-hidden border-2 border-white/10 hover:border-ball"
                  title={d.key}
                >
                  <img src={fileUrl(d.url)} alt={d.key} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-white/80 whitespace-pre-wrap">{profile.bio || "No description yet."}</p>
      )}
    </div>
  );
}
