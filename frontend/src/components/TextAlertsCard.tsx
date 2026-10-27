import { FormEvent, useEffect, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { ApiError, getMessagingSettings, sendPhoneCode, updateMe, verifyPhoneCode, type MessagingSettings } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useI18n } from "../lib/i18n";

const EVENTS: Record<string, string> = {
  new_bid: "A new bid on your job",
  hired: "You're hired",
  payment_released: "A payment is released",
  job_alert: "Jobs matching your alerts",
};

const CHANNELS = [
  { key: "smsOptIn", label: "SMS" },
  { key: "whatsappOptIn", label: "WhatsApp" },
] as const;

/** Settings card: verify a mobile number, then opt in to SMS and/or WhatsApp for key events. */
export function TextAlertsCard() {
  const { refreshUser } = useAuth();
  const { t } = useI18n();
  const [s, setS] = useState<MessagingSettings | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    getMessagingSettings()
      .then((r) => {
        if (!live) return;
        setS(r.messaging);
        setPhone(r.messaging.phone ?? "");
      })
      .catch(() => live && setMsg({ ok: false, text: t("Couldn't load text alert settings.") }));
    return () => {
      live = false;
    };
  }, [t]);

  const fail = (err: unknown) => setMsg({ ok: false, text: err instanceof ApiError ? err.message : t("Something went wrong. Try again.") });

  async function onSend(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await sendPhoneCode(phone.trim());
      setSentTo(r.sentTo);
      setS((prev) => (prev ? { ...prev, phone: phone.trim(), phoneVerified: phone.trim() === prev.phone && prev.phoneVerified } : prev));
      setMsg({ ok: true, text: `${t("We sent a 6-digit code to")} ${r.sentTo}.` });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await verifyPhoneCode(code.trim());
      setS((prev) => (prev ? { ...prev, phone: r.user.phone ?? null, phoneVerified: true, smsOptIn: false, whatsappOptIn: false } : prev));
      setSentTo(null);
      setCode("");
      setMsg({ ok: true, text: t("Number verified. Choose how you'd like to get texts.") });
      void refreshUser();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(key: "smsOptIn" | "whatsappOptIn", on: boolean) {
    setBusy(true);
    setMsg(null);
    const before = s;
    setS((prev) => (prev ? { ...prev, [key]: on } : prev)); // optimistic; rolled back on error
    try {
      const r = await updateMe({ [key]: on });
      setS((prev) => (prev ? { ...prev, smsOptIn: !!r.user.smsOptIn, whatsappOptIn: !!r.user.whatsappOptIn } : prev));
      setMsg({ ok: true, text: t("Saved.") });
    } catch (err) {
      setS(before);
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const off = s && !s.enabled;
  const verified = !!s?.phoneVerified;
  const changed = !!s && phone.trim() !== (s.phone ?? "");

  return (
    <section id="text-alerts" className="card scroll-mt-24 space-y-4 p-5 sm:p-6" aria-labelledby="text-alerts-title">
      <div>
        <h2 id="text-alerts-title" className="flex items-center gap-2 font-semibold text-slate-900">
          <MessageSquareText className="h-5 w-5 text-brand-700" aria-hidden /> {t("Text alerts (SMS / WhatsApp)")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {t("Get a short text for the moments that matter. Nothing else, and never marketing.")}
        </p>
      </div>

      {off && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700" role="status">
          {t("Text alerts aren't switched on for FixLocal yet. You'll still get in-app and email notifications.")}
        </p>
      )}

      {s && !off && (
        <>
          <ul className="grid gap-1 text-sm text-slate-700 sm:grid-cols-2" aria-label={t("What we text you about")}>
            {s.events.map((ev) => (
              <li key={ev} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" aria-hidden />
                {t(EVENTS[ev] ?? ev)}
              </li>
            ))}
          </ul>

          <form onSubmit={onSend} className="space-y-2">
            <label htmlFor="text-phone" className="label">
              {t("Mobile number")}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="text-phone"
                className="input min-w-0 flex-1 basis-48"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="98450 12345"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-describedby="text-phone-state"
              />
              <button type="submit" className="btn-secondary" disabled={busy || !phone.trim() || (verified && !changed)}>
                {sentTo ? t("Resend code") : t("Send code")}
              </button>
            </div>
            <p id="text-phone-state" className={`text-xs ${verified && !changed ? "text-emerald-700" : "text-slate-500"}`}>
              {verified && !changed ? t("Verified") : t("Not verified yet. We'll text you a code (standard rates may apply).")}
            </p>
          </form>

          {sentTo && (
            <form onSubmit={onVerify} className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 basis-40">
                <label htmlFor="text-code" className="label">
                  {t("6-digit code")}
                </label>
                <input
                  id="text-code"
                  className="input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <button type="submit" className="btn-primary" disabled={busy || code.length !== 6}>
                {t("Verify")}
              </button>
            </form>
          )}

          <fieldset disabled={!verified || changed || busy} className="space-y-2">
            <legend className="text-sm font-medium text-slate-900">{t("Send texts by")}</legend>
            {CHANNELS.map((c) => (
              <label key={c.key} className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-slate-200 px-3">
                <span className="text-sm text-slate-800">{t(c.label)}</span>
                <input type="checkbox" className="h-5 w-5" checked={s[c.key]} onChange={(e) => onToggle(c.key, e.target.checked)} />
              </label>
            ))}
            {!verified && <p className="text-xs text-slate-500">{t("Verify your number to turn these on.")}</p>}
          </fieldset>

          <p className="text-xs text-slate-500">
            {t("Quiet hours: nothing is sent between 10 PM and 8 AM IST. Texts from the night arrive at 8 AM.")}
          </p>
        </>
      )}

      {msg && (
        <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-rose-700"}`} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
