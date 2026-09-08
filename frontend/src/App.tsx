import { Routes, Route, NavLink, useParams, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import TournamentSetup from "./pages/TournamentSetup";
import Registration from "./pages/Registration";
import CourtControl from "./pages/CourtControl";
import Kiosk from "./pages/Kiosk";
import Leaderboard from "./pages/Leaderboard";
import BracketView from "./pages/BracketView";
import TournamentLogin from "./pages/TournamentLogin";
import Register from "./pages/community/Register";
import PlatformAdmin from "./pages/PlatformAdmin";
import Footer from "./components/Footer";
import Raffle from "./pages/Raffle";

function Shell() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  const { tournamentId } = useParams();
  if (loading) return <div className="min-h-screen p-10 text-center text-white/60">Loading account...</div>;
  const base = `/t/${tournamentId}`;
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `nav-pill ${isActive ? "nav-pill-active" : ""}`;
  const subscriptionNotice = user?.role === "ADMIN" && user.subscriptionExpiresAt
    ? Math.ceil((new Date(user.subscriptionExpiresAt).getTime() - Date.now()) / 86400000)
    : null;

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
        <nav className="glass-panel tournament-nav sticky top-2 z-20 flex min-w-0 flex-col gap-3 px-3 py-3 sm:top-4 sm:gap-4 sm:px-6 sm:py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ball/20 text-xl shadow-inner shadow-ball/30 ring-1 ring-ball/30">
              🏓
            </div>
            <div>
              <div className="font-display text-xl font-bold tracking-wide text-ball">Dink Board</div>
              <div className="text-[10px] uppercase tracking-[0.24em] text-white/45">Tournament Ops</div>
            </div>
          </div>

          <div className="mobile-nav-links flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto pb-1 sm:flex-wrap sm:gap-2">
            {user && (user.role === "ADMIN" || user.role === "SUPERADMIN") && <NavLink to={`${base}/registration`} className={linkClass}>Registration</NavLink>}
            {user && (user.role === "ADMIN" || user.role === "SUPERADMIN") && <NavLink to={`${base}/courts`} className={linkClass}>Court Control</NavLink>}
            <NavLink to={`${base}/kiosk`} className={linkClass}>Kiosk</NavLink>
            <NavLink to={`${base}/leaderboard`} className={linkClass}>Leaderboard</NavLink>
            <NavLink to={`${base}/bracket`} className={linkClass}>Bracket</NavLink>
            <NavLink to={`${base}/raffle`} className={linkClass}>Raffle</NavLink>
            {user?.role === "SUPERADMIN" && <NavLink to="/platform" className={linkClass}>Platform</NavLink>}
            {user ? <button onClick={() => logout()} className="nav-pill">Sign out</button> : <NavLink to="/login" state={{ from: location.pathname }} className="nav-pill">Admin sign in</NavLink>}
          </div>
        </nav>

        <main key={location.pathname} className="page-enter pb-10 pt-6">
          {subscriptionNotice !== null && subscriptionNotice <= 5 && subscriptionNotice >= 0 && <div className="mb-5 rounded-xl border border-ball/30 bg-ball/10 px-4 py-3 text-sm text-ball">Your subscription expires in {subscriptionNotice} day{subscriptionNotice === 1 ? "" : "s"}. Please contact the platform owner for renewal.</div>}
          <Routes>
            <Route path="registration" element={user && (user.role === "ADMIN" || user.role === "SUPERADMIN") ? <Registration /> : <Navigate to="/login" state={{ from: `${base}/registration` }} replace />} />
            <Route path="courts" element={user && (user.role === "ADMIN" || user.role === "SUPERADMIN") ? <CourtControl /> : <Navigate to="/login" state={{ from: `${base}/courts` }} replace />} />
            <Route path="kiosk" element={<Kiosk />} />
            <Route path="leaderboard" element={<Leaderboard />} />
            <Route path="bracket" element={<BracketView />} />
            <Route path="raffle" element={<Raffle />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen p-10 text-center text-white/60">Loading account...</div>;

  return (
    <Routes>
      <Route path="/login" element={<TournamentLogin />} />
      <Route path="/community/register" element={<Register />} />
      <Route path="/platform" element={user?.role === "SUPERADMIN" ? <PlatformAdmin /> : <Navigate to="/" replace />} />
      <Route path="/" element={<TournamentSetup />} />
      <Route path="/t/:tournamentId/*" element={<Shell />} />
      <Route path="*" element={<Navigate to={user ? "/" : "/login"} replace />} />
    </Routes>
  );
}
