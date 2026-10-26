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
  type AlertPreview,
  type JobAlert,
} from "../../api/features";
import { CATEGORIES, categoryLabel, fmtDate } from "../../lib/format";
import { RADII, criteriaOf, describeAlert, type AlertDraft as Draft } from "../../lib/jobAlerts";

export function JobAlertsPage() {
  const [params] = useSearchParams();
  const { success, error } = useToast();
  const [alerts, setAlerts] = useState<JobAlert[]>([]);
  const [max, setMax] = useState(10);
  const [loading, setLoading] = useState(true);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<AlertPreview | null>(null);
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
    const t = setTimeout(() => {
      previewJobAlert(criteria, ctrl.signal).then(setPreview).catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(t);
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
      const { alert } = await createJobAlert({ ...criteria, name });
      setAlerts((a) => [alert, ...a]);
      setDraft((d) => ({ ...d, name: "" }));
      success("Job alert saved. We'll notify you when a matching job is posted.");
    } catch (err) {
      error((err as Error).message);
    } finally {
      setBusy(false);
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
    <Shell title="Job alerts" subtitle="Get notified (in the app and by email) as soon as a matching job is posted">
      <div className="grid gap-6 lg:grid-cols-5">
        <form onSubmit={onCreate} className="card min-w-0 space-y-5 p-5 lg:col-span-3" aria-labelledby="new-alert">
          <h2 id="new-alert" className="font-display text-lg font-semibold">New alert</h2>

          <fieldset>
            <legend className="label">Trades</legend>
            <p className="mb-2 text-xs text-slate-500">Leave all off to hear about every category.</p>
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
                    {c.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="alert-radius">Distance</label>
              <select
                id="alert-radius"
                className="input"
                value={draft.radiusKm}
                onChange={(e) => setDraft({ ...draft, radiusKm: e.target.value })}
              >
                <option value="">Any distance (use city / area)</option>
                {RADII.map((r) => (
                  <option key={r} value={r} disabled={!pin}>
                    Within {r} km of my base
                  </option>
                ))}
              </select>
              {!pin && (
                <p className="mt-1 text-xs text-slate-500">
                  <MapPin className="mr-1 inline h-3 w-3" aria-hidden />
                  Set your base location in <Link to="/professional/profile">Portfolio</Link> to use distance.
                </p>
              )}
            </div>
            <div>
              <label className="label" htmlFor="alert-city">City</label>
              <input id="alert-city" className="input" value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} placeholder="e.g. Bengaluru" />
            </div>
            <div>
              <label className="label" htmlFor="alert-area">Area (optional)</label>
              <input id="alert-area" className="input" value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value })} placeholder="e.g. Indiranagar" />
            </div>
            <div>
              <label className="label" htmlFor="alert-budget">Minimum budget (₹, optional)</label>
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
              <label className="label" htmlFor="alert-site">Site</label>
              <select
                id="alert-site"
                className="input"
                value={draft.siteType}
                onChange={(e) => setDraft({ ...draft, siteType: e.target.value as Draft["siteType"] })}
              >
                <option value="">Homes and offices</option>
                <option value="residential">Homes only</option>
                <option value="office">Offices only</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="alert-name">Name (optional)</label>
              <input id="alert-name" className="input" maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Plumbing near home" />
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700" aria-live="polite">
            {preview == null ? (
              "Checking open jobs…"
            ) : (
              <>
                <strong>{preview.count}</strong> open job{preview.count === 1 ? "" : "s"} from the last 30 days match right now.
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
            <BellRing className="h-4 w-4" aria-hidden /> {alerts.length >= max ? `Limit of ${max} alerts reached` : "Save alert"}
          </button>
        </form>

        <section className="min-w-0 space-y-3 lg:col-span-2" aria-labelledby="my-alerts">
          <h2 id="my-alerts" className="font-display text-lg font-semibold">
            Your alerts <span className="text-sm font-normal text-slate-500">({alerts.length}/{max})</span>
          </h2>
          {loading ? (
            <Spinner />
          ) : alerts.length === 0 ? (
            <EmptyState title="No alerts yet" description="Save one and new matching jobs come straight to you." />
          ) : (
            <ul className="space-y-3">
              {alerts.map((a) => (
                <li key={a.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">{a.name}</p>
                      <p className="mt-0.5 text-sm text-slate-600">{describeAlert(a)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {a.active ? "Active" : "Paused"} · {a.matchCount} match{a.matchCount === 1 ? "" : "es"}
                        {a.lastMatchedAt ? ` · last ${fmtDate(a.lastMatchedAt)}` : ""}
                      </p>
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
