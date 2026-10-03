import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, fileUrl, PostSummary } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";

export default function Feed() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [showMine, setShowMine] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  const visiblePosts = (posts ?? []).filter((post) => !showMine || post.host.id === user?.id);

  async function becomeOrganizer() {
    setUpgrading(true);
    setUpgradeError(null);
    try {
      await api.post("/accounts/become-organizer");
      await refresh();
      navigate("/community/new");
    } catch (err: any) {
      setUpgradeError(err?.response?.data?.error || "Could not activate organizer access.");
    } finally {
      setUpgrading(false);
    }
  }

  useEffect(() => {
    api
      .get("/posts", { params: { search: search || undefined, location: location || undefined } })
      .then(({ data }) => {
        setPosts(data.posts);
        setNote(data.photoPolicyNote);
      })
      .catch(() => setError("Couldn't load tournaments right now."));
  }, [search, location]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display text-2xl font-bold text-white">Tournaments</h1>
        {user?.role === "ADMIN" || user?.role === "SUPERADMIN" ? (
          <Link to="/community/new" className="rounded-lg bg-ball text-neutral-900 font-display font-semibold px-4 py-2">
            + Post an event
          </Link>
        ) : user ? (
          <button onClick={becomeOrganizer} disabled={upgrading} className="rounded-lg bg-ball px-4 py-2 font-display font-semibold text-neutral-900 disabled:opacity-50">
            {upgrading ? "Activating…" : "Start 15-day organizer trial"}
          </button>
        ) : (
          <Link to="/community/register" state={{ role: "ADMIN" }} className="rounded-lg bg-ball text-neutral-900 font-display font-semibold px-4 py-2">
            Host an event
          </Link>
        )}
      </div>
      {upgradeError && <p className="mb-4 text-sm text-advance">{upgradeError}</p>}
      {user?.role === "ADMIN" && user.subscriptionStatus === "SUSPENDED" && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-advance/30 bg-advance/10 px-4 py-3 text-sm text-white/80"><span>Organizer access is paused until renewal is verified.</span><Link to="/community/billing" className="font-semibold text-ball">Renew subscription</Link></div>}
      {(user?.role === "ADMIN" || user?.role === "SUPERADMIN") && <div className="mb-4 flex gap-2">
        <button onClick={() => setShowMine(false)} className={`nav-pill ${!showMine ? "nav-pill-active" : ""}`}>All events</button>
        <button onClick={() => setShowMine(true)} className={`nav-pill ${showMine ? "nav-pill-active" : ""}`}>My events</button>
      </div>}
      <div className="mb-6 grid gap-3 sm:grid-cols-2"><input className="field" placeholder="Search tournaments" value={search} onChange={(e) => setSearch(e.target.value)} /><input className="field" placeholder="Filter by location" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
      {note && <p className="text-xs text-white/40 mb-6">{note}</p>}
      {error && <p className="text-advance">{error}</p>}
      {posts === null && !error && <p className="text-white/60">Loading…</p>}
      {posts && visiblePosts.length === 0 && (
        <p className="text-white/60">{showMine ? "You haven't published any events yet." : "No events posted yet. Be the first!"}</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visiblePosts.map((post) => (
          <Link
            key={post.id}
            to={`/community/${post.id}`}
            className="rounded-xl overflow-hidden bg-white/5 border border-white/10 hover:border-ball/60 transition-colors flex flex-col"
          >
            <div className="aspect-video bg-black/30">
              {post.photos[0] ? (
                <img src={fileUrl(post.photos[0])} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white/30 text-sm">
                  No photo yet
                </div>
              )}
            </div>
            <div className="p-4 flex-1 flex flex-col gap-1">
              <h2 className="font-display font-semibold text-white text-lg leading-snug">{post.title}</h2>
              <p className="text-sm text-white/60 line-clamp-2">{post.description}</p>
              {post.scheduledStart && <p className="text-xs text-ball/80">{new Date(post.scheduledStart).toLocaleString()}</p>}
              <div className="mt-auto pt-2 flex items-center justify-between text-xs text-white/50">
                <span>📍 {post.location}</span>
                {post.amount && <span className="text-ball">{post.amount}</span>}
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-white/10 mt-2">
                <img src={fileUrl(post.host.avatarUrl)} alt="" className="w-5 h-5 rounded-full object-cover" />
                <span className="text-xs text-white/50">by {post.host.username}</span>
                <span className="text-xs text-white/30 ml-auto">{post.capacity ? `${post.registrationCount} / ${post.capacity} spots` : `${post.registrationCount} registered`}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
