import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Shell } from "../../components/Shell";
import { getMyAnalytics, getProCounterAnalytics, type ProAnalytics, type CounterAnalytics } from "../../api/jobs";
import { Spinner } from "../../components/ui/Spinner";
import { ResponseSlaBadge } from "../../components/ui/ResponseSlaBadge";
import { EmptyState } from "../../components/ui/EmptyState";
import { categoryLabel, money } from "../../lib/format";

export function AnalyticsPage() {
  const [data, setData] = useState<ProAnalytics | null>(null);
  const [counterStats, setCounterStats] = useState<CounterAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getMyAnalytics()
      .then((r) => setData(r.analytics))
      .catch((e) => setErr(e.message || "Failed to load"))
      .finally(() => setLoading(false));
    getProCounterAnalytics()
      .then(setCounterStats)
      .catch(() => setCounterStats(null));
  }, []);

  const maxEarn = Math.max(1, ...(data?.earningsOverTime.map((m) => m.amount) || [1]));
  const maxCat = Math.max(1, ...(data?.categoryMix?.map((c) => c.count) || [1]));

  return (
    <Shell
      title="Analytics"
      subtitle="Wins, category mix, response pace, and earnings from your bids"
    >
      {loading ? (
        <Spinner />
      ) : err ? (
        <EmptyState title="Could not load analytics" description={err} />
      ) : !data ? (
        <EmptyState title="No data yet" description="Place bids to start building your stats." />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Jobs won" value={String(data.jobsWon)} />
            <Stat
              label="Win rate"
              value={`${data.winRate}%`}
              hint={`${data.jobsWon} of ${data.totalBids} bids`}
            />
            <Stat
              label="Avg rating"
              value={data.reviewCount ? data.averageRating.toFixed(1) : "—"}
              hint={`${data.reviewCount} review(s)`}
            />
            <Stat label="Earned (completed)" value={money(data.totalEarned)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Active bids" value={String(data.activeBids)} />
            <Stat
              label="In progress / awarded"
              value={String(data.inProgressJobs + data.awardedJobs)}
            />
            <Stat label="Completed jobs" value={String(data.completedJobs)} />
            <Stat
              label="Bids (30 days)"
              value={String(data.bidsLast30Days ?? 0)}
              hint="Recent activity"
            />
          </div>

          {data.responseSla && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Response SLA</span>
              <ResponseSlaBadge sla={data.responseSla} />
            </div>
          )}

          {counterStats && counterStats.sent > 0 && (
            <section className="card p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-900">Counter-offer SLA</h2>
              <p className="text-xs text-slate-500 mb-3">
                Homeowner counters you addressed vs declined · time-to-address
              </p>
              <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
                <Stat label="Received" value={String(counterStats.sent)} />
                <Stat
                  label="Addressed"
                  value={String(counterStats.addressed)}
                  hint={`${counterStats.addressRate}%`}
                />
                <Stat
                  label="Declined"
                  value={String(counterStats.declined)}
                  hint={`${counterStats.declineRate}%`}
                />
                <Stat
                  label="Avg time to address"
                  value={
                    counterStats.avgTimeToAddressHours != null
                      ? `${counterStats.avgTimeToAddressHours}h`
                      : "—"
                  }
                  hint={
                    counterStats.medianTimeToAddressHours != null
                      ? `med ${counterStats.medianTimeToAddressHours}h`
                      : undefined
                  }
                />
              </div>
            </section>
          )}

          {data.slaTrends && (
            <section className="card p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-900">SLA trends</h2>
              <p className="text-xs text-slate-500 mb-3">
                Job post → your bid · last 7 / 30 days
                {data.slaTrends.clean ? "" : " · building sample…"}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">7 days</p>
                  <div className="mt-1.5">
                    <ResponseSlaBadge sla={data.slaTrends.d7} />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    n={data.slaTrends.d7.sampleSize ?? 0}
                    {data.slaTrends.d7.hours != null ? ` · ~${data.slaTrends.d7.hours}h avg` : ""}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">30 days</p>
                  <div className="mt-1.5">
                    <ResponseSlaBadge sla={data.slaTrends.d30} />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    n={data.slaTrends.d30.sampleSize ?? 0}
                    {data.slaTrends.d30.hours != null ? ` · ~${data.slaTrends.d30.hours}h avg` : ""}
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-2">
                  Response hours trend (lower is better)
                </p>
                <SlaSparkline
                  d7={data.slaTrends.d7.hours}
                  d30={data.slaTrends.d30.hours}
                  spark={data.slaSparkline}
                />
              </div>
            </section>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Stat
              label="Avg response"
              value={
                data.avgResponseHours != null ? formatHours(data.avgResponseHours) : "—"
              }
              hint={
                data.responseSampleSize
                  ? `Job post → your bid · n=${data.responseSampleSize}`
                  : "Place bids to measure response time"
              }
            />
            <Stat
              label="Median response"
              value={
                data.medianResponseHours != null
                  ? formatHours(data.medianResponseHours)
                  : "—"
              }
              hint="Heuristic from bid timestamps"
            />
          </div>

          <section className="card p-5 sm:p-6">
            <h2 className="font-semibold text-lg text-slate-900 mb-1">Category mix</h2>
            <p className="text-sm text-slate-500 mb-4">
              Won jobs by category · earned from completed only
            </p>
            {!data.categoryMix?.length ? (
              <p className="text-sm text-slate-500">Win a job to see category breakdown.</p>
            ) : (
              <ul className="space-y-3">
                {data.categoryMix.map((row) => (
                  <li key={row.category} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-xs font-medium text-slate-600 capitalize">
                      {categoryLabel(row.category)}
                    </span>
                    <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{
                          width: `${Math.max(row.count > 0 ? 8 : 0, (row.count / maxCat) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="w-28 shrink-0 text-right text-sm text-slate-700">
                      {row.count} · {money(row.earned)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5 sm:p-6">
            <h2 className="font-semibold text-lg text-slate-900 mb-1">Earnings over time</h2>
            <p className="text-sm text-slate-500 mb-4">
              Last 6 months · from completed awarded jobs (simulated)
            </p>
            <ul className="space-y-3">
              {data.earningsOverTime.map((row) => (
                <li key={row.month} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-xs font-medium text-slate-500">
                    {row.month}
                  </span>
                  <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-brand-600 transition-all"
                      style={{
                        width: `${Math.max(row.amount > 0 ? 6 : 0, (row.amount / maxEarn) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-sm font-semibold text-slate-800">
                    {money(row.amount)}
                  </span>
                </li>
              ))}
            </ul>
            {data.totalEarned === 0 && (
              <p className="mt-4 text-sm text-slate-500">
                No completed payouts yet.{" "}
                <Link to="/professional" className="text-brand-700 font-medium">
                  Browse open jobs
                </Link>
              </p>
            )}
          </section>
        </div>
      )}
    </Shell>
  );
}


function SlaSparkline({
  d7,
  d30,
  spark,
}: {
  d7?: number | null;
  d30?: number | null;
  spark?: { label: string; hours: number | null; n: number }[];
}) {
  const bars =
    spark && spark.some((s) => s.hours != null)
      ? spark.map((s) => ({
          label: s.label,
          hours: s.hours,
          n: s.n,
        }))
      : [
          { label: "30d", hours: d30 ?? null, n: 0 },
          { label: "7d", hours: d7 ?? null, n: 0 },
        ];
  const vals = bars.map((b) => b.hours).filter((h): h is number => h != null && h >= 0);
  const maxH = Math.max(1, ...(vals.length ? vals : [1]));
  const w = 280;
  const h = 56;
  const pad = 4;
  const bw = (w - pad * 2) / Math.max(bars.length, 1);
  const points = bars
    .map((b, i) => {
      if (b.hours == null) return null;
      const x = pad + i * bw + bw / 2;
      const y = h - pad - (b.hours / maxH) * (h - pad * 2);
      return `${x},${y}`;
    })
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-sm h-14" role="img" aria-label="SLA sparkline">
        {bars.map((b, i) => {
          const barH = b.hours == null ? 2 : Math.max(4, (b.hours / maxH) * (h - pad * 2));
          const x = pad + i * bw + bw * 0.15;
          const y = h - pad - barH;
          return (
            <rect
              key={b.label}
              x={x}
              y={y}
              width={bw * 0.7}
              height={barH}
              rx={2}
              className={b.hours == null ? "fill-slate-200" : "fill-brand-500/80"}
            />
          );
        })}
        {points && (
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-emerald-600"
            points={points}
          />
        )}
      </svg>
      <div className="flex flex-wrap gap-2 text-[10px] text-slate-500">
        {bars.map((b) => (
          <span key={b.label} className="rounded-sm bg-slate-50 px-1.5 py-0.5 ring-1 ring-slate-200">
            {b.label}: {b.hours != null ? `~${b.hours}h` : "—"}
            {b.n ? ` (n=${b.n})` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatHours(h: number) {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h}h`;
  return `${Math.round((h / 24) * 10) / 10}d`;
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold text-brand-800">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
