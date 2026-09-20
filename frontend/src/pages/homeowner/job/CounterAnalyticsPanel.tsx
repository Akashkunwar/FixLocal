import { BarChart3 } from "lucide-react";
import type { CounterAnalytics } from "../../../api/jobs";

/** Sent / addressed / declined counter-offers on this job. */
export function CounterAnalyticsPanel({ stats }: { stats: CounterAnalytics }) {
  return (
    <div className="mb-4 rounded-xl bg-violet-50/80 p-3 ring-1 ring-violet-100">
      <div className="mb-2 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-violet-700" />
        <h3 className="text-sm font-semibold text-slate-900">
          Counter analytics (this job)
        </h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "Sent", value: stats.sent },
          {
            label: "Addressed",
            value: stats.addressed,
            sub: `${stats.addressRate}%`,
          },
          {
            label: "Declined",
            value: stats.declined,
            sub: `${stats.declineRate}%`,
          },
          {
            label: "Avg address",
            value:
              stats.avgTimeToAddressHours != null
                ? `${stats.avgTimeToAddressHours}h`
                : "—",
            sub:
              stats.afterAddressedAccepted > 0
                ? `${stats.afterAddressedAccepted} hired after`
                : stats.pending
                  ? `${stats.pending} pending`
                  : undefined,
          },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded-xl bg-white/80 px-3 py-2 ring-1 ring-violet-100"
          >
            <p className="text-[10px] uppercase tracking-wide text-slate-400">
              {c.label}
            </p>
            <p className="text-xl font-bold text-slate-900">{c.value}</p>
            {"sub" in c && c.sub ? (
              <p className="text-[11px] text-slate-500">{c.sub}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
