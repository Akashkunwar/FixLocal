import { useEffect, useState } from "react";
import { Copy, Gift, MessageCircle, Share2 } from "lucide-react";
import { createMyReferralCode, getMyReferrals, type Referral } from "../api/features";
import { REFERRAL_STATUS_LABEL, whatsappShareUrl } from "../lib/referrals";
import { fmtDate, money } from "../lib/format";
import { useToast } from "./Toast";
import { t } from "../lib/i18n";

/** Settings card: a personal invite link plus who joined through it. Rewards are not offered (yet). */
export function InviteFriends() {
  const { success, error } = useToast();
  const [ref, setRef] = useState<Referral | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    let live = true;
    getMyReferrals()
      .then((r) => live && setRef(r.referral))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  async function create() {
    setBusy(true);
    try {
      setRef((await createMyReferralCode()).referral);
    } catch {
      error(t("Couldn't create your invite link. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!ref?.link) return;
    try {
      await navigator.clipboard.writeText(ref.link);
      success(t("Invite link copied"));
    } catch {
      error(t("Copy failed. Select the link and copy it instead."));
    }
  }

  async function share() {
    if (!ref?.link) return;
    try {
      await navigator.share({ title: t("Join me on FixLocal"), text: ref.shareText ?? undefined, url: ref.link });
    } catch {
      /* the user closed the share sheet */
    }
  }

  return (
    <section className="card space-y-4 p-5 sm:p-6" aria-labelledby="invite-title">
      <div>
        <h2 id="invite-title" className="flex items-center gap-2 font-semibold text-slate-900">
          <Gift className="h-5 w-5 text-brand-700" aria-hidden /> {t("Invite friends")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {t("Share your personal link. When a friend finishes their first job on FixLocal, you each get")}{" "}
          {ref ? money(ref.rewardAmount) : "₹100"} {t("FixLocal credit (simulated, like escrow).")}
        </p>
      </div>
      {failed && <p className="text-sm text-rose-700">{t("Couldn't load your invites right now.")}</p>}
      {!ref && !failed && <p className="text-sm text-slate-500">{t("Loading…")}</p>}
      {ref && !ref.link && (
        <button type="button" className="btn-primary" onClick={create} disabled={busy}>
          {busy ? t("Creating…") : t("Create my invite link")}
        </button>
      )}
      {ref?.link && (
        <>
          <div>
            <label htmlFor="invite-link" className="label">
              {t("Your invite link (code")}{" "}<span className="font-mono">{ref.code}</span>)
            </label>
            <input id="invite-link" className="input font-mono text-sm" readOnly value={ref.link} onFocus={(e) => e.target.select()} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={copy}>
              <Copy className="h-4 w-4" aria-hidden /> {t("Copy link")}
            </button>
            <a
              className="btn-secondary btn-sm"
              href={whatsappShareUrl(ref.shareText ?? ref.link)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle className="h-4 w-4" aria-hidden /> {t("Share on WhatsApp")}
            </a>
            {canShare && (
              <button type="button" className="btn-secondary btn-sm" onClick={share}>
                <Share2 className="h-4 w-4" aria-hidden /> {t("More ways to share")}
              </button>
            )}
          </div>
        </>
      )}
      {ref && (
        <>
          <dl className="grid grid-cols-3 gap-2 text-center">
            {(
              [
                ["Signed up", ref.totals.joined],
                ["Confirmed", ref.totals.confirmed],
                ["First job done", ref.totals.completedFirstJob],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="rounded-xl bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">{t(label)}</dt>
                <dd className="font-display text-xl font-semibold text-slate-900">{n}</dd>
              </div>
            ))}
          </dl>
          {ref.earned > 0 && (
            <p className="text-sm text-slate-700">
              {t("Credit earned from invites:")}{" "}<strong>{money(ref.earned)}</strong>{" "}
              <a href="#credit" className="text-brand-700 underline">
                {t("See your credit")}
              </a>
            </p>
          )}
          {ref.people.length > 0 && (
            <ul className="divide-y divide-slate-100 text-sm" aria-label={t("People you invited")}>
              {ref.people.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-medium text-slate-800">{p.firstName}</span>
                  <span className="text-slate-500">
                    {t(REFERRAL_STATUS_LABEL[p.status])} {t("· joined")}{" "}{fmtDate(p.joinedAt)}
                    {p.reward === "granted" && p.rewardAmount > 0 && <strong className="text-emerald-700"> · {money(p.rewardAmount)} {t("earned")}</strong>}
                    {p.reward === "granted" && p.rewardAmount === 0 && t(" · monthly limit reached")}
                    {p.reward === "blocked" && t(" · not eligible")}
                    {p.reward === "reversed" && t(" · credit reversed")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
