import type { ShortlistInviteAnalytics } from "../../../api/jobs";

/** Rank → invite → bid conversion for pros on the client's shortlist. */
export function ShortlistFunnelPanel({
  funnel,
}: {
  funnel: ShortlistInviteAnalytics;
}) {
  return (
    <section className="card p-5 space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Shortlist invite funnel</h2>
        <p className="text-xs text-slate-500">
          Rank → invite → bid conversion for pros on your shortlist
          {funnel.avgRankBid != null
            ? ` · avg rank of bidders #${funnel.avgRankBid}`
            : ""}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {funnel.funnel.map((s) => (
          <div
            key={s.stage}
            className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200"
          >
            <p className="text-[10px] uppercase tracking-wide text-slate-400">
              {s.label}
            </p>
            <p className="text-xl font-bold text-slate-900">{s.count}</p>
            <p className="text-[11px] text-slate-500">
              {s.stage === "ranked" ? "pool" : `${s.rate}%`}
            </p>
          </div>
        ))}
      </div>
      {funnel.byRank && funnel.byRank.length > 0 && (
        <ul className="space-y-1">
          {funnel.byRank.slice(0, 8).map((r) => (
            <li
              key={r.rank}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 text-xs ring-1 ring-slate-100"
            >
              <span className="font-medium text-slate-800">
                Rank #{r.rank}
                {r.names?.length ? ` · ${r.names.slice(0, 2).join(", ")}` : ""}
              </span>
              <span className="text-slate-500">
                invited {r.invited} · bid {r.bidAfter}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
