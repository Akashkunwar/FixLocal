import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import { Shell } from "../../components/Shell";
import { Spinner } from "../../components/ui/Spinner";
import { Badge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { getMySpending, type Spending } from "../../api/features";
import { categoryLabel, fmtDate, money } from "../../lib/format";
import { monthLabel, spendingCsv } from "../../lib/spending";
import { clientPath } from "../../lib/paths";
import { t, plural, tf } from "../../lib/i18n";

const FILTERS = [
  { key: "all", label: "All jobs", match: () => true },
  { key: "paid", label: "Paid", match: (s: string) => s === "completed" },
  { key: "active", label: "In progress", match: (s: string) => ["awarded", "in_progress", "pending_confirmation", "disputed"].includes(s) },
  { key: "open", label: "Open", match: (s: string) => ["open", "bidding_closed"].includes(s) },
  { key: "cancelled", label: "Cancelled", match: (s: string) => s === "cancelled" },
];

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["\ufeff", text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SpendingPage() {
  const [data, setData] = useState<Spending | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    getMySpending()
      .then((r) => setData(r.spending))
      .catch((e: Error) => setErr(e.message || "Couldn't load your spending"));
  }, []);

  const jobs = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    return (data?.jobs || []).filter((j) => f.match(j.status));
  }, [data, filter]);
  const maxMonth = Math.max(1, ...(data?.months.map((m) => m.amount) || [1]));

  return (
    <Shell title={t("Spending & history")} subtitle={t("What you've paid, what's held in escrow, and every job you've posted")}>
      {err ? (
        <p className="card p-6 text-sm text-slate-700" role="alert">{err}</p>
      ) : !data ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            {[
              [t("Paid to pros"), money(data.totals.paid), plural(data.totals.jobsCompleted, "{n} completed job", "{n} completed jobs")],
              [t("Held in escrow"), money(data.totals.inEscrow), plural(data.totals.jobsActive, "{n} job in progress", "{n} jobs in progress")],
              [t("Refunded"), money(data.totals.refunded), tf("{n} cancelled", { n: data.totals.jobsCancelled })],
              [t("Average paid job"), money(data.totals.averageJob), tf("{n} posted in total", { n: data.totals.jobsPosted })],
            ].map(([label, value, hint]) => (
              <div key={label} className="card min-w-0 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-1 font-display text-xl font-semibold text-brand-800 sm:text-2xl">{value}</p>
                <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <section className="card min-w-0 p-5 lg:col-span-2" aria-labelledby="by-month">
              <h2 id="by-month" className="font-semibold text-lg text-slate-900">{t("Paid by month")}</h2>
              <p className="mb-4 text-sm text-slate-500">{t("Last 12 months · releases from escrow")}</p>
              <ul className="space-y-2">
                {data.months.map((m) => (
                  <li key={m.month} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-xs font-medium text-slate-600">{monthLabel(m.month)}</span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                      <div
                        className="h-full rounded-full bg-brand-600"
                        style={{ width: `${Math.max(m.amount > 0 ? 4 : 0, (m.amount / maxMonth) * 100)}%` }}
                      />
                    </div>
                    <span className="w-24 shrink-0 text-right text-sm font-semibold text-slate-800">{money(m.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>

            <div className="min-w-0 space-y-6">
              <section className="card p-5" aria-labelledby="by-category">
                <h2 id="by-category" className="font-semibold text-lg text-slate-900">{t("By category")}</h2>
                {data.byCategory.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">{t("Nothing paid yet.")}</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm">
                    {data.byCategory.map((c) => (
                      <li key={c.category} className="flex justify-between gap-2">
                        <span className="text-slate-700">{categoryLabel(c.category)} <span className="text-slate-500">· {c.jobs}</span></span>
                        <span className="font-semibold">{money(c.paid)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="card p-5" aria-labelledby="top-pros">
                <h2 id="top-pros" className="font-semibold text-lg text-slate-900">{t("Pros you've paid most")}</h2>
                {data.topPros.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">{t("Your hired pros show up here, ready to book again.")}</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm">
                    {data.topPros.map((p) => (
                      <li key={p.proId} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">
                          <Link to={`/pros/${p.proId}`}>{p.name}</Link>
                          <span className="text-slate-500"> · {plural(p.jobs, "{n} job", "{n} jobs")}</span>
                        </span>
                        <span className="font-semibold">{money(p.paid)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>

          <section className="card min-w-0 p-5" aria-labelledby="history">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 id="history" className="font-semibold text-lg text-slate-900">{t("Job history")}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="history-filter">{t("Show")}</label>
                <select id="history-filter" className="input py-1.5" value={filter} onChange={(e) => setFilter(e.target.value)}>
                  {FILTERS.map((f) => (
                    <option key={f.key} value={f.key}>{t(f.label)}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={!data.jobs.length}
                  onClick={() => download(`fixlocal-spending-${new Date().toISOString().slice(0, 10)}.csv`, spendingCsv(data.jobs))}
                >
                  <Download className="h-4 w-4" aria-hidden /> {t("Download CSV")}
                </button>
              </div>
            </div>
            {jobs.length === 0 ? (
              <EmptyState
                title={t("No jobs here")}
                description={t("Jobs you post show up here with what you paid.")}
                action={<Link className="btn-primary btn-sm no-underline" to={clientPath("jobs/new")}>{t("Post a job")}</Link>}
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {jobs.map((j) => (
                  <li key={j.jobId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3">
                    <div className="min-w-0">
                      <Link className="font-medium" to={clientPath(`jobs/${j.jobId}`)}>{j.title}</Link>
                      <p className="text-xs text-slate-500">
                        {categoryLabel(j.category)} {t("· posted")}{" "}{fmtDate(j.createdAt)}
                        {j.pro ? ` · ${j.pro.name}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <Badge status={j.status} />
                      <span className="min-w-20 text-right">
                        <span className="block font-semibold">{money(j.paid)}</span>
                        {j.inEscrow > 0 && <span className="block text-xs text-slate-500">{money(j.inEscrow)} {t("held")}</span>}
                        {j.refunded > 0 && <span className="block text-xs text-slate-500">{money(j.refunded)} {t("refunded")}</span>}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-slate-500">{data.note}</p>
          </section>
        </div>
      )}
    </Shell>
  );
}
