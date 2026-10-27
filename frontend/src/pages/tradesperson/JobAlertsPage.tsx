import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BellRing, MapPin, Pause, Play, Trash2 } from "lucide-react";
import { Shell } from "../../components/Shell";
import { Spinner } from "../../components/ui/Spinner";
import { EmptyState } from "../../components/ui/EmptyState";
import { useToast } from "../../components/Toast";
import { getProfile } from "../../api/jobs";
import {
  createJobAlert,
  deleteJobAlert,
  listJobAlerts,
  previewJobAlert,
  updateJobAlert,
  type AlertFrequency,
  type AlertPreview,
  type JobAlert,
} from "../../api/features";
import { CATEGORIES, categoryLabel, fmtDate } from "../../lib/format";
import { RADII, criteriaOf, describeAlert, type AlertDraft as Draft } from "../../lib/jobAlerts";
import { t } from "../../lib/i18n";

const FREQUENCIES: { value: AlertFrequency; label: string; hint: string }[] = [
  { value: "daily", label: "Daily digest", hint: "One summary around 8 AM with every match from the last 24 hours." },
  { value: "instant", label: "Instant", hint: "A notification as soon as each matching job is posted." },
];

export function JobAlertsPage() {
  const [params] = useSearchParams();
  const { success, error } = useToast();
  const [alerts, setAlerts] = useState<JobAlert[]>([]);
  const [max, setMax] = useState(10);
  const [loading, setLoading] = useState(true);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<AlertPreview | null>(null);
  const [frequency, setFrequency] = useState<AlertFrequency>("daily");
  const [draft, setDraft] = useState<Draft>(() => ({
    name: "",
    categories: params.get("category") ? [params.get("category")!] : [],
    city: params.get("city") || "",
    area: params.get("area") || "",
    radiusKm: "",
    minBudget: params.get("minBudget") || "",
    siteType: params.get("siteType") === "office" || params.get("siteType") === "residential" ? (params.get("siteType") as "office") : "",
  }));

  useEffect(() => {
    listJobAlerts()
      .then((r) => {
        setAlerts(r.alerts);
        setMax(r.max);
      })
      .catch((e: Error) => error(e.message))
      .finally(() => setLoading(false));
    getProfile()
      .then(({ profile }) => {
        if (profile.lat != null && profile.lng != null) setPin({ lat: Number(profile.lat), lng: Number(profile.lng) });
        setDraft((d) => (d.city || !profile.city ? d : { ...d, city: profile.city }));
      })
      .catch(() => undefined);
  }, [error]);

  const criteria = useMemo(() => criteriaOf(draft, pin), [draft, pin]);
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      previewJobAlert(criteria, ctrl.signal).then(setPreview).catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [criteria]);

  const toggleCategory = (value: string) =>
    setDraft((d) => ({
      ...d,
      categories: d.categories.includes(value) ? d.categories.filter((c) => c !== value) : [...d.categories, value],
    }));

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const name =
        draft.name.trim() ||
        `${draft.categories.length ? draft.categories.map(categoryLabel).join(", ") : "All jobs"}${draft.city ? ` in ${draft.city}` : ""}`.slice(0, 80);
      const { alert } = await createJobAlert({ ...criteria, name, frequency });
      setAlerts((a) => [alert, ...a]);
      setDraft((d) => ({ ...d, name: "" }));
      success(
        frequency === "daily"
          ? "Job alert saved. Matching jobs arrive in one summary each morning."
          : "Job alert saved. We'll notify you as soon as a matching job is posted."
      );
    } catch (err) {
      error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onFrequency(a: JobAlert, next: AlertFrequency) {
    try {
      const { alert } = await updateJobAlert(a.id, { frequency: next });
      setAlerts((list) => list.map((x) => (x.id === a.id ? alert : x)));
    } catch (err) {
      error((err as Error).message);
    }
  }

  async function onToggle(a: JobAlert) {
    try {
      const { alert } = await updateJobAlert(a.id, { active: !a.active });
      setAlerts((list) => list.map((x) => (x.id === a.id ? alert : x)));
    } catch (err) {
      error((err as Error).message);
    }
  }

  async function onDelete(a: JobAlert) {
    try {
      await deleteJobAlert(a.id);
      setAlerts((list) => list.filter((x) => x.id !== a.id));
      success("Alert deleted");
    } catch (err) {
      error((err as Error).message);
    }
  }

  return (
    <Shell title={t("Job alerts")} subtitle={t("Get notified (in the app and by email) as soon as a matching job is posted")}>
      <div className="grid gap-6 lg:grid-cols-5">
        <form onSubmit={onCreate} className="card min-w-0 space-y-5 p-5 lg:col-span-3" aria-labelledby="new-alert">
          <h2 id="new-alert" className="font-display text-lg font-semibold">{t("New alert")}</h2>

          <fieldset>
            <legend className="label">{t("Trades")}</legend>
            <p className="mb-2 text-xs text-slate-500">{t("Leave all off to hear about every category.")}</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => {
                const on = draft.categories.includes(c.value);
                return (
                  <button
                    key={c.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleCategory(c.value)}
                    className={
                      on
                        ? "rounded-full border border-brand-700 bg-brand-700 px-3 py-1.5 text-sm font-medium text-white"
                        : "rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-brand-600"
                    }
                  >
                    <span aria-hidden>{c.emoji} </span>
                    {t(c.label)}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="alert-radius">{t("Distance")}</label>
              <select
                id="alert-radius"
                className="input"
                value={draft.radiusKm}
                onChange={(e) => setDraft({ ...draft, radiusKm: e.target.value })}
              >
                <option value="">{t("Any distance (use city / area)")}</option>
                {RADII.map((r) => (
                  <option key={r} value={r} disabled={!pin}>
                    {t("Within")}{" "}{r} {t("km of my base")}
                  </option>
                ))}
              </select>
              {!pin && (
                <p className="mt-1 text-xs text-slate-500">
                  <MapPin className="mr-1 inline h-3 w-3" aria-hidden />
                  {t("Set your base location in")}{" "}<Link to="/professional/profile">{t("Portfolio")}</Link> {t("to use distance.")}
                </p>
              )}
            </div>
            <div>
              <label className="label" htmlFor="alert-city">{t("City")}</label>
              <input id="alert-city" className="input" value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} placeholder={t("e.g. Bengaluru")} />
            </div>
            <div>
              <label className="label" htmlFor="alert-area">{t("Area (optional)")}</label>
              <input id="alert-area" className="input" value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value })} placeholder={t("e.g. Indiranagar")} />
            </div>
            <div>
              <label className="label" htmlFor="alert-budget">{t("Minimum budget (₹, optional)")}</label>
              <input
                id="alert-budget"
                className="input"
                inputMode="numeric"
                value={draft.minBudget}
                onChange={(e) => setDraft({ ...draft, minBudget: e.target.value.replace(/\D/g, "") })}
                placeholder="e.g. 1000"
              />
            </div>
            <div>
              <label className="label" htmlFor="alert-site">{t("Site")}</label>
              <select
                id="alert-site"
                className="input"
                value={draft.siteType}
                onChange={(e) => setDraft({ ...draft, siteType: e.target.value as Draft["siteType"] })}
              >
                <option value="">{t("Homes and offices")}</option>
                <option value="residential">{t("Homes only")}</option>
                <option value="office">{t("Offices only")}</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="alert-name">{t("Name (optional)")}</label>
              <input id="alert-name" className="input" maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("e.g. Plumbing near home")} />
            </div>
          </div>

          <fieldset>
            <legend className="label">{t("How often")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {FREQUENCIES.map((f) => (
                <label
                  key={f.value}
                  className={`flex min-h-[44px] cursor-pointer gap-2 rounded-xl border p-3 text-sm ${
                    frequency === f.value ? "border-brand-500 bg-brand-50" : "border-slate-200"
                  }`}
                >
                  <input type="radio" name="alert-frequency" value={f.value} checked={frequency === f.value} onChange={() => setFrequency(f.value)} className="mt-0.5" />
                  <span>
                    <span className="block font-semibold text-slate-900">{t(f.label)}</span>
                    <span className="block text-slate-600">{t(f.hint)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700" aria-live="polite">
            {preview == null ? (
              t("Checking open jobs…")
            ) : (
              <>
                <strong>{preview.count}</strong> {t("open job")}{preview.count === 1 ? "" : "s"} {t("from the last 30 days match right now.")}
                {preview.jobs.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {preview.jobs.map((j) => (
                      <li key={j.id} className="truncate">
                        <Link to={`/professional/jobs/${j.id}`}>{j.title}</Link>
                        <span className="text-slate-500"> · {[j.area, j.city].filter(Boolean).join(", ")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <button type="submit" className="btn-primary w-full sm:w-auto" disabled={busy || alerts.length >= max}>
            <BellRing className="h-4 w-4" aria-hidden /> {alerts.length >= max ? `Limit of ${max} alerts reached` : t("Save alert")}
          </button>
        </form>

        <section className="min-w-0 space-y-3 lg:col-span-2" aria-labelledby="my-alerts">
          <h2 id="my-alerts" className="font-display text-lg font-semibold">
            {t("Your alerts")}{" "}<span className="text-sm font-normal text-slate-500">({alerts.length}/{max})</span>
          </h2>
          {loading ? (
            <Spinner />
          ) : alerts.length === 0 ? (
            <EmptyState title={t("No alerts yet")} description={t("Save one and new matching jobs come straight to you.")} />
          ) : (
            <ul className="space-y-3">
              {alerts.map((a) => (
                <li key={a.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">{a.name}</p>
                      <p className="mt-0.5 text-sm text-slate-600">{describeAlert(a)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {a.active ? t("Active") : t("Paused")} · {a.matchCount} {t("match")}{a.matchCount === 1 ? "" : "es"}
                        {a.lastMatchedAt ? ` · last ${fmtDate(a.lastMatchedAt)}` : ""}
                      </p>
                      <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                        <span>{t("Delivery")}</span>
                        <select
                          className="input !w-auto !py-1 text-xs"
                          value={a.frequency}
                          onChange={(e) => onFrequency(a, e.target.value as AlertFrequency)}
                          aria-label={`How often for ${a.name}`}
                        >
                          <option value="daily">{t("Daily digest")}</option>
                          <option value="instant">{t("Instant")}</option>
                        </select>
                      </label>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" className="btn-ghost btn-sm" onClick={() => onToggle(a)} aria-label={`${a.active ? "Pause" : "Resume"} ${a.name}`}>
                        {a.active ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                      </button>
                      <button type="button" className="btn-ghost btn-sm text-rose-700" onClick={() => onDelete(a)} aria-label={`Delete ${a.name}`}>
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Shell>
  );
}
