import { Link } from "react-router-dom";
import type { ReactNode } from "react";

export function Privacy() {
  return <LegalLayout title="Privacy Policy"><p>We collect account details, player registration information, profile content, contact details, and payment proof only to operate tournaments and review entry requests.</p><p>Payment proofs are private and accessible only to the submitting player and the tournament administrator. You may request correction or deletion of your personal information through the platform owner.</p><p>Uploaded profile images and tournament media are stored for platform operation. Tournament administrators are responsible for handling participant information lawfully.</p></LegalLayout>;
}

export function Terms() {
  return <LegalLayout title="Terms of Use"><p>Administrators are responsible for accurate tournament details, payment instructions, player approvals, scoring, and final results.</p><p>Players must submit truthful registration information and valid payment proof. Approval is controlled by the tournament administrator and does not guarantee participation if event rules or capacity change.</p><p>Use of the platform must comply with applicable laws and venue rules. Contact the platform owner to report abuse or request account assistance.</p></LegalLayout>;
}

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return <div className="min-h-screen bg-neutral-950 px-4 py-10 text-white"><div className="mx-auto max-w-2xl space-y-5"><Link to="/community" className="text-sm text-white/50 hover:text-white">Back to tournaments</Link><h1 className="font-display text-3xl font-bold text-ball">{title}</h1><div className="space-y-4 text-sm leading-7 text-white/70">{children}</div></div></div>;
}
