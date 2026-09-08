import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import Footer from "../components/Footer";

type Account = { id: string; username: string; role: "ADMIN" | "PLAYER"; createdAt: string; subscriptionExpiresAt?: string | null; subscriptionStatus?: string | null };

export default function PlatformAdmin() {
  const { user, logout } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Account["role"]>("ADMIN");
  const [message, setMessage] = useState("");
  const [monthlyPrice, setMonthlyPrice] = useState(0);
  const [priceMessage, setPriceMessage] = useState("");

  const load = () => api.get<Account[]>("/accounts").then((response) => setAccounts(response.data));
  useEffect(() => { load(); api.get<{ monthlyPriceCents: number }>("/billing/settings").then((response) => setMonthlyPrice(response.data.monthlyPriceCents)); }, []);

  async function savePrice(event: FormEvent) {
    event.preventDefault();
    const response = await api.patch<{ monthlyPriceCents: number }>("/billing/settings", { monthlyPriceCents: Math.round(monthlyPrice * 100) });
    setMonthlyPrice(response.data.monthlyPriceCents / 100);
    setPriceMessage("Monthly price saved.");
  }

  async function approvePayment(id: string) {
    await api.patch(`/accounts/${id}/approve-payment`);
    setPriceMessage("Payment approved and subscription extended for 30 days.");
    load();
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      await api.post("/accounts", { username: username.trim(), password, role });
      setUsername(""); setPassword("");
      setMessage("Account created.");
      load();
    } catch (error: any) {
      setMessage(error?.response?.data?.error || "Could not create account.");
    }
  }

  return (
    <div className="flex min-h-screen flex-col px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="glass-panel tournament-nav sticky top-2 z-20 flex min-w-0 flex-col gap-3 px-3 py-3 sm:top-4 sm:gap-4 sm:px-6 sm:py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ball/20 text-xl shadow-inner shadow-ball/30 ring-1 ring-ball/30">🏓</div>
            <div>
              <div className="font-display text-xl font-bold tracking-wide text-ball">Dink Board</div>
              <div className="text-[10px] uppercase tracking-[0.24em] text-white/45">Platform Console</div>
            </div>
          </div>
          <div className="mobile-nav-links flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto pb-1 sm:flex-wrap sm:gap-2">
            <Link to="/" className="nav-pill">Tournaments</Link>
            <span className="nav-pill nav-pill-active">Account Console</span>
            <button onClick={() => logout()} className="nav-pill">Sign out</button>
          </div>
        </header>
        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <form onSubmit={createAccount} className="glass-panel space-y-4 p-6">
            <h2 className="font-display text-2xl font-bold text-white">Create account</h2>
            <div><label className="field-label">Username</label><input className="field" value={username} onChange={(event) => setUsername(event.target.value)} required /></div>
            <div><label className="field-label">Temporary password</label><input className="field" type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
            <div><label className="field-label">Account type</label><select className="field" value={role} onChange={(event) => setRole(event.target.value as Account["role"])}><option value="ADMIN">Customer admin</option><option value="PLAYER">Player</option></select></div>
            {message && <p className="text-sm text-ball">{message}</p>}
            <button className="action-button w-full">Create account</button>
          </form>
          <div className="space-y-6">
            <form onSubmit={savePrice} className="glass-panel space-y-4 p-6">
              <div><h2 className="font-display text-2xl font-bold text-white">Monthly subscription</h2><p className="mt-1 text-sm text-white/55">Admins receive 15 free days, then each approval activates 30 more days.</p></div>
              <div><label className="field-label">Price per month</label><div className="flex items-center gap-2"><span className="text-white/55">$</span><input className="field" type="number" min="0" step="0.01" value={monthlyPrice} onChange={(event) => setMonthlyPrice(Number(event.target.value))} /></div></div>
              {priceMessage && <p className="text-sm text-ball">{priceMessage}</p>}
              <button className="action-button">Save subscription price</button>
            </form>
            <section className="glass-panel p-6"><div className="mb-4 flex items-center justify-between"><h2 className="font-display text-2xl font-bold text-white">Managed accounts</h2><span className="text-xs text-white/45">{user?.username}</span></div><div className="space-y-2">{accounts.map((account) => <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"><div><div className="text-white">{account.username}</div>{account.role === "ADMIN" && <div className="text-xs text-white/45">{account.subscriptionStatus || "TRIAL"} · expires {account.subscriptionExpiresAt ? new Date(account.subscriptionExpiresAt).toLocaleDateString() : "not set"}</div>}</div><div className="flex items-center gap-2"><span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-widest text-white/55">{account.role}</span>{account.role === "ADMIN" && <button onClick={() => approvePayment(account.id)} className="secondary-button px-3 py-2 text-xs text-emerald-300">Approve payment</button>}</div></div>)}</div></section>
          </div>
        </div>
      </div>
      <div className="mt-auto">
        <Footer />
      </div>
    </div>
  );
}