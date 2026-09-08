import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fileUrl, PostSummary } from "../../lib/api";

export default function Feed() {
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/posts")
      .then(({ data }) => {
        setPosts(data.posts);
        setNote(data.photoPolicyNote);
      })
      .catch(() => setError("Couldn't load tournaments right now."));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display text-2xl font-bold text-white">Tournaments</h1>
        <Link
          to="/community/new"
          className="rounded-lg bg-ball text-neutral-900 font-display font-semibold px-4 py-2"
        >
          + Post a tournament
        </Link>
      </div>
      {note && <p className="text-xs text-white/40 mb-6">{note}</p>}
      {error && <p className="text-advance">{error}</p>}
      {posts === null && !error && <p className="text-white/60">Loading…</p>}
      {posts && posts.length === 0 && (
        <p className="text-white/60">No tournaments posted yet. Be the first!</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {posts?.map((post) => (
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
              <div className="mt-auto pt-2 flex items-center justify-between text-xs text-white/50">
                <span>📍 {post.location}</span>
                {post.amount && <span className="text-ball">{post.amount}</span>}
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-white/10 mt-2">
                <img src={fileUrl(post.host.avatarUrl)} alt="" className="w-5 h-5 rounded-full object-cover" />
                <span className="text-xs text-white/50">by {post.host.username}</span>
                <span className="text-xs text-white/30 ml-auto">{post.registrationCount} registered</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
