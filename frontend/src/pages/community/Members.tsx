import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fileUrl, PublicProfile } from "../../lib/api";

export default function Members() {
  const [members, setMembers] = useState<PublicProfile[] | null>(null);

  useEffect(() => {
    api.get<PublicProfile[]>("/users").then(({ data }) => setMembers(data));
  }, []);

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-white mb-6">Members</h1>
      {members === null && <p className="text-white/60">Loading…</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {members?.map((m) => (
          <Link
            key={m.id}
            to={`/community/profile/${m.username}`}
            className="flex items-center gap-3 rounded-xl bg-white/5 border border-white/10 hover:border-ball/60 p-3"
          >
            <img src={fileUrl(m.avatarUrl)} alt="" className="w-12 h-12 rounded-full object-cover border border-white/20" />
            <div className="min-w-0">
              <p className="font-display font-semibold text-white truncate">{m.username}</p>
              <p className="text-xs text-white/50 truncate">{m.bio || "No description yet"}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
