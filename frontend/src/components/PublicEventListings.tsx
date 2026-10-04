import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fileUrl, PostSummary } from "../lib/api";

export default function PublicEventListings() {
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get<{ posts: PostSummary[] }>("/posts")
      .then(({ data }) => setPosts(data.posts.slice(0, 3)))
      .catch(() => setError(true));
  }, []);

  return (
    <section className="mx-auto mb-8 max-w-6xl px-4 sm:px-6 lg:px-8" aria-labelledby="public-events-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-ball/80">Community postings</p>
          <h2 id="public-events-heading" className="mt-1 font-display text-2xl font-bold text-white">Events &amp; Open Play</h2>
        </div>
        <Link to="/community" className="text-sm font-semibold text-ball hover:underline">Browse all postings</Link>
      </div>

      {error && <p className="border-y border-white/10 py-4 text-sm text-white/55">Event postings are temporarily unavailable. <Link to="/community" className="text-ball hover:underline">Open the event board</Link></p>}
      {posts === null && !error && <p className="border-y border-white/10 py-4 text-sm text-white/45">Loading postings…</p>}
      {posts?.length === 0 && <p className="border-y border-white/10 py-4 text-sm text-white/45">No events or open play posted yet.</p>}

      {posts && posts.length > 0 && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => <Link key={post.id} to={`/community/${post.id}`} className="group overflow-hidden rounded-lg border border-white/10 bg-white/[0.03] transition-colors hover:border-ball/50">
          <div className="aspect-[16/7] overflow-hidden bg-black/30">
            {post.photos[0] ? <img src={fileUrl(post.photos[0])} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" /> : <div className="flex h-full items-center justify-center text-sm text-white/30">Event posting</div>}
          </div>
          <div className="p-3">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display font-semibold text-white group-hover:text-ball">{post.title}</h3>
              {post.amount && <span className="shrink-0 text-xs text-ball">{post.amount}</span>}
            </div>
            <p className="mt-1 line-clamp-1 text-xs text-white/50">{post.location}{post.scheduledStart ? ` · ${new Date(post.scheduledStart).toLocaleDateString()}` : ""}</p>
          </div>
        </Link>)}
      </div>}
    </section>
  );
}
