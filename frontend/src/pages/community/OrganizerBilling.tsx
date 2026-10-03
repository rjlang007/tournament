import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import Footer from "../../components/Footer";

type Plan = {
  monthlyPriceCents: number;
  subscriptionPaymentInstructions: string | null;
  subscriptionExpiresAt: string | null;
  subscriptionStatus: string | null;
  paymentStatus: string | null;
  paymentSubmittedAt: string | null;
  hasPaymentProof: boolean;
};

export default function OrganizerBilling() {
  const { user } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function loadPlan() {
    const { data } = await api.get<Plan>("/billing/plan");
    setPlan(data);
  }

  useEffect(() => {
    loadPlan().catch(() => setError("Could not load the subscription plan."));
  }, []);

  if (user?.role !== "ADMIN") return <Navigate to="/community" replace />;

  async function submitProof(event: FormEvent) {
    event.preventDefault();
    if (!proof) {
      setError("Choose a payment receipt image first.");
      return;
    }
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const form = new FormData();
      form.append("proof", proof);
      await api.post("/accounts/subscription-payment-proof", form, { headers: { "Content-Type": "multipart/form-data" } });
      setProof(null);
      setMessage("Payment proof submitted. Your organizer access will resume after verification.");
      await loadPlan();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Could not submit payment proof.");
    } finally {
      setSubmitting(false);
    }
  }

  const price = plan?.monthlyPriceCents
    ? new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(plan.monthlyPriceCents / 100)
    : "Free";

  return (
    <div className="flex min-h-screen flex-col px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold text-white">Organizer subscription</h1>
            <p className="mt-1 text-sm text-white/55">{user.username}</p>
          </div>
          <Link to="/community" className="secondary-button px-3 py-2 text-sm">Event board</Link>
        </header>

        {!plan ? <p className="text-sm text-white/60">Loading plan…</p> : <>
          <section className="glass-panel space-y-4 p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><div className="text-sm text-white/55">Monthly price</div><div className="font-display text-3xl font-bold text-ball">{price}</div></div>
              <div className="text-right text-sm text-white/60"><div>Status: {plan.subscriptionStatus ?? "Not started"}</div><div>Expires: {plan.subscriptionExpiresAt ? new Date(plan.subscriptionExpiresAt).toLocaleDateString() : "Not set"}</div></div>
            </div>
            {plan.subscriptionPaymentInstructions ? <div className="border-t border-white/10 pt-4"><h2 className="mb-2 font-display font-semibold text-white">Payment instructions</h2><p className="whitespace-pre-wrap text-sm text-white/70">{plan.subscriptionPaymentInstructions}</p></div> : <p className="text-sm text-white/55">The platform owner has not added payment instructions yet.</p>}
            {plan.paymentStatus && <p className="text-sm text-white/60">Latest payment: {plan.paymentStatus.toLowerCase()}{plan.paymentSubmittedAt ? ` · submitted ${new Date(plan.paymentSubmittedAt).toLocaleString()}` : ""}</p>}
          </section>

          {plan.monthlyPriceCents > 0 ? <form onSubmit={submitProof} className="glass-panel space-y-4 p-6">
            <div><h2 className="font-display text-xl font-bold text-white">Submit renewal proof</h2><p className="mt-1 text-sm text-white/55">After the platform owner verifies your payment, your subscription is extended by 30 days.</p></div>
            <input type="file" accept="image/*" onChange={(event) => setProof(event.target.files?.[0] ?? null)} className="text-sm text-white/70" />
            {message && <p className="text-sm text-emerald-300">{message}</p>}
            {error && <p className="text-sm text-advance">{error}</p>}
            <button type="submit" disabled={submitting || !proof} className="action-button disabled:opacity-50">{submitting ? "Submitting…" : "Upload payment proof"}</button>
          </form> : <div className="glass-panel p-6 text-sm text-white/65">Organizer access is currently free. No renewal payment is due.</div>}
        </>}
      </div>
      <div className="mt-auto"><Footer /></div>
    </div>
  );
}