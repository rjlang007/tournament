import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { fileUrl } from "../../lib/api";
import Footer from "../../components/Footer";

export default function CommunityShell() {
  const { user, logout } = useAuth();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-lg text-sm font-display font-semibold tracking-wide transition-colors ${
      isActive ? "bg-ball text-neutral-900" : "text-white/70 hover:text-white hover:bg-white/10"
    }`;

  return (
    <div className="min-h-screen bg-neutral-950">
      <nav className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-court-bg/40 px-4 py-3 sm:px-6 sm:py-4">
        <span className="mr-2 w-full font-display text-xl font-bold text-ball sm:mr-4 sm:w-auto">🏆 Community Board</span>
        <NavLink to="/community" end className={linkClass}>
          Browse
        </NavLink>
        {user && (
          <>
            <NavLink to="/community/new" className={linkClass}>
              Post a tournament
            </NavLink>
            <NavLink to="/community/members" className={linkClass}>
              Members
            </NavLink>
          </>
        )}
        <div className="ml-0 flex w-full items-center gap-2 sm:ml-auto sm:w-auto sm:gap-3">
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
