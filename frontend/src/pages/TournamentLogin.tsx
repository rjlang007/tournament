import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Footer from "../components/Footer";

export default function TournamentLogin() {
  const { user, login, error, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const destination = (location.state as { from?: string } | null)?.from || "/";

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setShowIntro(false);
      return;
    }
    const timer = window.setTimeout(() => setShowIntro(false), 4500);
    return () => window.clearTimeout(timer);
  }, []);

  if (loading) return <div className="min-h-screen p-10 text-center text-white/60">Loading account...</div>;
  if (user) return <Navigate to={destination} replace />;

  if (showIntro) {
    return (
      <main className="login-intro" aria-label="Welcome to Dink Board">
        <div className="login-intro-court" aria-hidden="true" />
        <div className="login-intro-content">
          <div className="login-intro-kicker">Dink Board presents</div>
          <h1 className="login-intro-title">Welcome, Dinker.</h1>
          <div className="login-intro-rule" aria-hidden="true" />
          <p className="login-intro-subtitle">Your next game starts here.</p>
          <p className="login-intro-credit">By Engr. RJO Productions</p>
        </div>
      </main>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    const ok = await login(username.trim(), password);
    setSubmitting(false);
    if (ok) navigate(destination, { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col px-4 py-16 sm:px-6">
      <div className="flex-1">
        <div className="glass-panel mx-auto max-w-md p-8">
        <div className="mb-8">
          <div className="text-[10px] uppercase tracking-[0.28em] text-ball/80">Dink Board access</div>
          <h1 className="mt-2 font-display text-4xl font-bold text-white">Sign in to play</h1>
          <p className="mt-3 text-sm leading-6 text-white/60">Players can follow their games and standings. Administrators can run the tournament.</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="field-label">Username</label>
            <input className="field" value={username} onChange={(event) => setUsername(event.target.value)} autoFocus required />
          </div>
          <div>
            <label className="field-label">Password</label>
            <input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <button className="action-button w-full py-3" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="mt-5 text-sm text-white/55">
          Need an account? <Link className="text-ball hover:underline" to="/community/register">Create one</Link>
        </p>
        </div>
      </div>
      <Footer />
    </div>
  );
}
