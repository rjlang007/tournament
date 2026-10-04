import { Link, NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { fileUrl } from "../../lib/api";
import { api } from "../../lib/api";
import Footer from "../../components/Footer";

export default function CommunityShell() {
  const { user, logout } = useAuth();
  const [unread, setUnread] = useState(0);
  useEffect(() => { if (user) api.get<Array<{ readAt: string | null }>>("/notifications").then(({ data }) => setUnread(data.filter((item) => !item.readAt).length)); }, [user]);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-lg text-sm font-display font-semibold tracking-wide transition-colors ${
      isActive ? "bg-ball text-neutral-900" : "text-white/70 hover:text-white hover:bg-white/10"
    }`;

  return (
    <div className="min-h-screen bg-neutral-950">
      <nav className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-court-bg/40 px-4 py-3 sm:px-6 sm:py-4">
        <Link to="/community" className="mr-2 flex w-full flex-col font-display font-bold text-ball sm:mr-4 sm:w-auto">
          <span className="text-xl">Playwell</span>
          <span className="text-[9px] font-normal uppercase tracking-[0.18em] text-white/45">Find a game. Bring the fun.</span>
        </Link>
        <NavLink to="/community" end className={linkClass}>
          Browse
        </NavLink>
        <NavLink to="/community/leaderboard" className={linkClass}>
          Player rankings
        </NavLink>
        {user && (
          <>
            {(user.role === "ADMIN" || user.role === "SUPERADMIN") && <NavLink to="/community/new" className={linkClass}>
              Post an event
            </NavLink>}
            {user.role === "ADMIN" && <NavLink to="/community/billing" className={linkClass}>Subscription</NavLink>}
            <NavLink to="/community/members" className={linkClass}>
              Members
            </NavLink>
            <NavLink to="/community/notifications" className={linkClass}>Notifications{unread > 0 ? ` (${unread})` : ""}</NavLink>
          </>
        )}
        <div className="ml-0 flex w-full items-center gap-2 sm:ml-auto sm:w-auto sm:gap-3">
          <Link to="/" className="text-sm text-white/60 hover:text-white px-3 py-2">Court dashboard</Link>
          {user ? (
            <>
              <NavLink to={`/community/profile/${user.username}`} className="flex items-center gap-2 text-white/80 hover:text-white">
                <img src={fileUrl(user.avatarUrl)} alt="" className="w-8 h-8 rounded-full object-cover border border-white/20" />
                <span className="text-sm font-display">{user.username}</span>
              </NavLink>
              <button
                onClick={() => logout()}
                className="text-sm text-white/60 hover:text-white px-3 py-2"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/community/login" className={linkClass}>
                Sign in
              </NavLink>
              <NavLink to="/community/register" className={linkClass}>
                Create account
              </NavLink>
            </>
          )}
        </div>
      </nav>
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <Outlet />
      </div>
      <Footer />
    </div>
  );
}
