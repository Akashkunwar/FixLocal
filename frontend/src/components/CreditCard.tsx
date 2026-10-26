import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Coins } from "lucide-react";
import { getMyCredits, type CreditEntry, type Credits } from "../api/features";
import { fmtDate, money } from "../lib/format";
import { useAuth } from "../auth/AuthContext";

const KIND_LABEL: Record<CreditEntry["kind"], string> = {
  referral_reward: "Referral reward",
  applied_payment: "Used at a hire",
  applied_payout: "Added to a payout",
  reversal: "Reversed",
  restored: "Returned (hire cancelled)",
};

/** Settings card: FixLocal credit balance, how it's used, and the history. */
export function CreditCard() {
  const { user } = useAuth();
  const [credits, setCredits] = useState<Credits | null>(null);
  const [failed, setFailed] = useState(false);
  const jobBase = user?.role === "TRADESPERSON" ? "/professional/jobs" : "/client/jobs";

  useEffect(() => {
    let live = true;
    getMyCredits()
      .then((r) => live && setCredits(r.credits))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  return (
    <section id="credit" className="card scroll-mt-24 space-y-4 p-5 sm:p-6" aria-labelledby="credit-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="credit-title" className="flex items-center gap-2 font-semibold text-slate-900">
            <Coins className="h-5 w-5 text-brand-700" aria-hidden /> FixLocal credit
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {credits?.usedAt === "payout"
              ? "Credit is added to your next payout automatically."
              : "Credit comes off what you fund at your next hire automatically."}{" "}
            Simulated, like escrow.
          </p>
        </div>
        <p className="font-display text-3xl font-semibold text-slate-900" aria-live="polite">
          <span className="sr-only">Balance: </span>
          {credits ? money(credits.balance) : "—"}
        </p>
      </div>
      {failed && <p className="text-sm text-rose-700">Couldn't load your credit right now.</p>}
      {credits && credits.entries.length === 0 && (
        <p className="text-sm text-slate-600">
          No credit yet. Invite a friend below: when they finish their first job (worth {money(credits.minJobAmount)} or more), you each
          get {money(credits.rewardAmount)}.
        </p>
      )}
      {credits && credits.entries.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm" aria-label="Credit history">
          {credits.entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="font-medium text-slate-800">{KIND_LABEL[e.kind]}</span>
                <span className="block text-xs text-slate-500">
                  {fmtDate(e.createdAt)}
                  {e.jobId && e.jobTitle && (
                    <>
                      {" · "}
                      <Link to={`${jobBase}/${e.jobId}`} className="underline">{e.jobTitle}</Link>
                    </>
                  )}
                  {e.note ? ` · ${e.note}` : ""}
                </span>
              </span>
              <span className={`font-semibold ${e.amount >= 0 ? "text-emerald-700" : "text-slate-700"}`}>
                {e.amount >= 0 ? "+" : "−"}
                {money(Math.abs(e.amount))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
