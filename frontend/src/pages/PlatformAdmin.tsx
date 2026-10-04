import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { API_URL, api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import Footer from "../components/Footer";

type Account = { id: string; username: string; role: "ADMIN" | "PLAYER"; createdAt: string; subscriptionExpiresAt?: string | null; subscriptionStatus?: string | null; subscriptionPaymentStatus?: string | null; subscriptionPaymentSubmittedAt?: string | null; hasSubscriptionPaymentProof?: boolean };
type FinanceData = {
  totals: Record<string, number>;
  entries: { id: string; type: string; amountCents: number; description: string; createdAt: string }[];
  payouts: { id: string; amountCents: number; status: string; organizer: { username: string }; tournament: { name: string }; failureReason?: string | null }[];
  eligiblePayouts: { id: string; name: string; organizer: string; payoutAccountConfigured: boolean; pendingRegistrationCount: number; amountCents: number }[];
};

export default function PlatformAdmin() {
  const { user, logout } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Account["role"]>("ADMIN");
  const [message, setMessage] = useState("");
  const [monthlyPrice, setMonthlyPrice] = useState(0);
  const [paymentInstructions, setPaymentInstructions] = useState("");
  const [priceMessage, setPriceMessage] = useState("");
  const [finance, setFinance] = useState<FinanceData | null>(null);
  const [financeMessage, setFinanceMessage] = useState("");

  const load = () => api.get<Account[]>("/accounts").then((response) => setAccounts(response.data));
  const loadFinance = () => api.get<FinanceData>("/payments/ledger").then((response) => setFinance(response.data)).catch((error: any) => {
    setFinanceMessage(error?.response?.data?.error || "Could not load event finance.");
  });
  useEffect(() => {
    load();
    if (user?.role === "SUPERADMIN") {
      loadFinance();
      api.get<{ monthlyPriceCents: number; subscriptionPaymentInstructions: string }>("/billing/settings").then((response) => {
        setMonthlyPrice(response.data.monthlyPriceCents / 100);
        setPaymentInstructions(response.data.subscriptionPaymentInstructions);
      });
    }
  }, [user?.role]);

  async function savePrice(event: FormEvent) {
    event.preventDefault();
    const response = await api.patch<{ monthlyPriceCents: number }>("/billing/settings", { monthlyPriceCents: Math.round(monthlyPrice * 100), subscriptionPaymentInstructions: paymentInstructions });
    setMonthlyPrice(response.data.monthlyPriceCents / 100);
    setPriceMessage("Monthly price saved.");
  }

  async function approvePayment(id: string) {
    if (!confirm("Confirm that you verified this organizer renewal payment and extend access for 30 days?")) return;
    await api.patch(`/accounts/${id}/approve-payment`);
    setPriceMessage("Payment approved and subscription extended for 30 days.");
    load();
  }

  async function rejectPayment(id: string) {
    if (!confirm("Reject this organizer renewal payment submission?")) return;
    await api.patch(`/accounts/${id}/reject-payment`);
    setPriceMessage("Renewal proof rejected.");
    load();
  }

  async function requestPayout(eventId: string, eventName: string) {
    if (!confirm(`Send the verified PayMongo balance for "${eventName}" to its organizer? This action cannot be automatically retried.`)) return;
    setFinanceMessage("");
    try {
      const { data } = await api.post<{ message?: string }>(`/payments/tournaments/${eventId}/payout`);
      setFinanceMessage(data.message || "Payout request sent to PayMongo.");
      await loadFinance();
    } catch (error: any) {
      setFinanceMessage(error?.response?.data?.error || "Could not start the organizer payout.");
    }
  }

  const money = (cents: number) => `₱${(cents / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
            <Link to="/" aria-label="Go to tournament dashboard" className="flex h-10 w-10 items-center justify-center rounded-xl bg-ball/20 text-xl shadow-inner shadow-ball/30 ring-1 ring-ball/30">🏓</Link>
            <div>
              <div className="brand-lockup font-display text-xl font-bold tracking-wide text-ball">Playwell</div>
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
            <div><label className="field-label">Account type</label><select className="field" value={role} onChange={(event) => setRole(event.target.value as Account["role"])}><option value="ADMIN">Organizer</option><option value="PLAYER">Player</option></select></div>
            {message && <p className="text-sm text-ball">{message}</p>}
            <button className="action-button w-full">Create account</button>
          </form>
          <div className="space-y-6">
            {user?.role === "SUPERADMIN" && finance && <section className="glass-panel space-y-5 p-6">
              <div>
                <h2 className="font-display text-2xl font-bold text-white">Event finance</h2>
                <p className="mt-1 text-sm text-white/55">Online checkout funds are collected by Playwell. Offline payments are organizer-reported and are not cash held by the platform.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-white/10 p-3"><p className="text-xs text-white/45">Online payments collected</p><p className="mt-1 text-xl font-semibold text-white">{money(finance.totals.EVENT_PAYMENT ?? 0)}</p></div>
                <div className="rounded-lg border border-white/10 p-3"><p className="text-xs text-white/45">Commission earned (online)</p><p className="mt-1 text-xl font-semibold text-emerald-300">{money(finance.totals.PLATFORM_COMMISSION ?? 0)}</p></div>
                <div className="rounded-lg border border-white/10 p-3"><p className="text-xs text-white/45">PayMongo fees</p><p className="mt-1 text-xl font-semibold text-advance">{money(Math.abs(finance.totals.PROCESSING_FEE ?? 0))}</p></div>
                <div className="rounded-lg border border-white/10 p-3"><p className="text-xs text-white/45">Verified organizer subscription payments</p><p className="mt-1 text-xl font-semibold text-emerald-300">{money(finance.totals.SUBSCRIPTION_PAYMENT ?? 0)}</p></div>
                <div className="rounded-lg border border-white/10 p-3"><p className="text-xs text-white/45">Offline payments verified by organizers (not platform cash)</p><p className="mt-1 text-xl font-semibold text-white">{money(finance.totals.OFFLINE_EVENT_PAYMENT ?? 0)}</p></div>
                <div className="rounded-lg border border-white/10 p-3 sm:col-span-2"><p className="text-xs text-white/45">Accrued commission from offline payments (not yet collected)</p><p className="mt-1 text-xl font-semibold text-ball">{money(finance.totals.ACCRUED_PLATFORM_COMMISSION ?? 0)}</p></div>
              </div>
              {financeMessage && <p className="text-sm text-ball">{financeMessage}</p>}
              <div>
                <h3 className="mb-2 font-display font-semibold text-white">Ready for organizer payout</h3>
                {finance.eligiblePayouts.length === 0 ? <p className="text-sm text-white/45">No finalized events are awaiting payout.</p> : <div className="space-y-2">{finance.eligiblePayouts.map((event) => <div key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 p-3">
                  <div><p className="text-sm text-white">{event.name}</p><p className="text-xs text-white/45">Organizer: @{event.organizer} · balance: {money(event.amountCents)}{event.pendingRegistrationCount ? ` · ${event.pendingRegistrationCount} payment(s) pending` : ""}</p></div>
                  <button disabled={!event.payoutAccountConfigured || event.pendingRegistrationCount > 0 || event.amountCents <= 0} onClick={() => requestPayout(event.id, event.name)} className="secondary-button px-3 py-2 text-xs text-emerald-300 disabled:opacity-40">{!event.payoutAccountConfigured ? "Payout account missing" : event.pendingRegistrationCount ? "Resolve pending payments" : event.amountCents <= 0 ? "No payout due" : "Send payout"}</button>
                </div>)}</div>}
              </div>
              <div>
                <h3 className="mb-2 font-display font-semibold text-white">Payouts needing attention</h3>
                {finance.payouts.length === 0 ? <p className="text-sm text-white/45">No pending, processing, or failed payouts.</p> : <div className="space-y-2">{finance.payouts.map((payout) => <div key={payout.id} className="rounded-lg border border-white/10 p-3 text-sm"><p className="text-white">{payout.tournament.name} · {money(payout.amountCents)} · {payout.status.toLowerCase()}</p><p className="text-xs text-white/45">Organizer: @{payout.organizer.username}{payout.failureReason ? ` · ${payout.failureReason}` : ""}</p></div>)}</div>}
              </div>
              <div>
                <h3 className="mb-2 font-display font-semibold text-white">Recent ledger entries</h3>
                {finance.entries.length === 0 ? <p className="text-sm text-white/45">No event payment activity yet.</p> : <div className="max-h-64 space-y-1 overflow-auto">{finance.entries.slice(0, 30).map((entry) => <div key={entry.id} className="flex justify-between gap-3 border-b border-white/5 py-2 text-xs"><span className="text-white/70">{entry.description} <span className="text-white/35">· {entry.type.toLowerCase().replace(/_/g, " ")}</span></span><span className={entry.amountCents < 0 ? "shrink-0 text-advance" : "shrink-0 text-white"}>{money(entry.amountCents)}</span></div>)}</div>}
              </div>
            </section>}
            {user?.role === "SUPERADMIN" && !finance && <section className="glass-panel p-6"><p className="text-sm text-white/55">{financeMessage || "Loading event finance…"}</p></section>}
            {user?.role === "SUPERADMIN" && <form onSubmit={savePrice} className="glass-panel space-y-4 p-6">
                <div><h2 className="font-display text-2xl font-bold text-white">Organizer subscription</h2><p className="mt-1 text-sm text-white/55">Organizers receive a 15-day trial; approved manual payments add 30 days.</p></div>
                <div><label className="field-label">Price per month (PHP)</label><div className="flex items-center gap-2"><span className="text-white/55">₱</span><input className="field" type="number" min="0" step="0.01" value={monthlyPrice} onChange={(event) => setMonthlyPrice(Number(event.target.value))} /></div></div>
                <div><label className="field-label">Manual payment instructions</label><textarea className="field" rows={3} value={paymentInstructions} onChange={(event) => setPaymentInstructions(event.target.value)} placeholder="Wallet or bank details for organizer renewals" /></div>
              {priceMessage && <p className="text-sm text-ball">{priceMessage}</p>}
              <button className="action-button">Save subscription price</button>
            </form>}
            <section className="glass-panel p-6"><div className="mb-4 flex items-center justify-between"><h2 className="font-display text-2xl font-bold text-white">Managed accounts</h2><span className="text-xs text-white/45">{user?.username}</span></div><div className="space-y-2">{accounts.map((account) => <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"><div><div className="text-white">{account.username}</div>{account.role === "ADMIN" && <div className="mt-1 text-xs text-white/45">{account.subscriptionStatus || "TRIAL"} · expires {account.subscriptionExpiresAt ? new Date(account.subscriptionExpiresAt).toLocaleDateString() : "not set"}{account.subscriptionPaymentStatus ? ` · payment ${account.subscriptionPaymentStatus.toLowerCase()}` : ""}</div>}{account.role === "ADMIN" && account.subscriptionPaymentSubmittedAt && <div className="text-xs text-white/40">Submitted {new Date(account.subscriptionPaymentSubmittedAt).toLocaleString()}</div>}</div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-widest text-white/55">{account.role === "ADMIN" ? "ORGANIZER" : "PLAYER"}</span>{account.role === "ADMIN" && account.hasSubscriptionPaymentProof && <a href={`${API_URL}/api/accounts/${account.id}/subscription-payment-proof`} target="_blank" rel="noreferrer" className="text-xs text-ball">View proof</a>}{user?.role === "SUPERADMIN" && account.role === "ADMIN" && account.subscriptionPaymentStatus === "PENDING" && account.hasSubscriptionPaymentProof && <button onClick={() => approvePayment(account.id)} className="secondary-button px-3 py-2 text-xs text-emerald-300">Confirm payment</button>}{user?.role === "SUPERADMIN" && account.role === "ADMIN" && account.subscriptionPaymentStatus === "PENDING" && account.hasSubscriptionPaymentProof && <button onClick={() => rejectPayment(account.id)} className="secondary-button px-3 py-2 text-xs text-red-300">Reject proof</button>}</div></div>)}</div></section>
          </div>
        </div>
      </div>
      <div className="mt-auto">
        <Footer />
      </div>
    </div>
  );
}