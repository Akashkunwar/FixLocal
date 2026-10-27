import { FormEvent, useState } from "react";
import { Building2 } from "lucide-react";
import { ApiError, updateMe } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useI18n } from "../lib/i18n";
import { isValidGstin, normalizeGstin } from "../lib/gstin";

/** Settings card: optional business name and GSTIN, printed on payment summaries for offices and GST-registered pros. */
export function BusinessDetailsCard() {
  const { user, refreshUser } = useAuth();
  const { t } = useI18n();
  const [name, setName] = useState(user?.businessName ?? "");
  const [gstin, setGstin] = useState(user?.gstin ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const gstinBad = gstin.trim() !== "" && !isValidGstin(gstin);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (gstinBad) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await updateMe({ businessName: name.trim() || null, gstin: gstin.trim() ? normalizeGstin(gstin) : null });
      setName(r.user.businessName ?? "");
      setGstin(r.user.gstin ?? "");
      setMsg({ ok: true, text: t("Saved.") });
      void refreshUser();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : t("Something went wrong. Try again.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="business" className="card scroll-mt-24 space-y-4 p-5 sm:p-6" aria-labelledby="business-title">
      <div>
        <h2 id="business-title" className="flex items-center gap-2 font-semibold text-slate-900">
          <Building2 className="h-5 w-5 text-brand-700" aria-hidden /> {t("Business & GST details")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {t("Optional. Shown on payment summaries so offices can claim input tax credit and GST-registered professionals can bill correctly.")}
        </p>
      </div>
      <form onSubmit={onSave} className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="business-name" className="label">
            {t("Business name")}
          </label>
          <input id="business-name" className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="gstin" className="label">
            {t("GSTIN")}
          </label>
          <input
            id="gstin"
            className="input uppercase"
            maxLength={20}
            placeholder="27AAPFU0939F1ZV"
            autoComplete="off"
            aria-invalid={gstinBad}
            aria-describedby={gstinBad ? "gstin-error" : undefined}
            value={gstin}
            onChange={(e) => setGstin(e.target.value)}
          />
          {gstinBad && (
            <p id="gstin-error" className="mt-1 text-xs text-red-700">
              {t("Enter a valid 15-character GSTIN")}
            </p>
          )}
        </div>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={busy || gstinBad}>
            {t("Save business details")}
          </button>
          {msg && (
            <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`} role={msg.ok ? "status" : "alert"}>
              {msg.text}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
