import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SlidersHorizontal } from "lucide-react";
import type { Bid, Job } from "../../../api/jobs";
import { EmptyState } from "../../../components/ui/EmptyState";
import { CounterAmountSparkline } from "./CounterAmountSparkline";
import { CounterAnalyticsPanel } from "./CounterAnalyticsPanel";
import { BidCard } from "./BidCard";
import { BidGlance } from "./BidGlance";
import { money, fmtDateTimeFull } from "../../../lib/format";
import {
  BID_SORT_OPTIONS,
  bidHighlights,
  sortBids,
  type BidSortKey,
} from "../../../lib/bidCompare";
import type { JobDetailState } from "./useJobDetail";
import { t, tf } from "../../../lib/i18n";

/**
 * The client's "pick a pro" screen: a short at-a-glance comparison, sortable bid
 * cards with each pro's track record, and the deeper tools (best-value maths,
 * negotiation timeline, escrow what-ifs) folded away under "More comparison tools".
 */
export function BidComparePanel({
  s,
  job,
  sortedBids,
}: {
  s: JobDetailState;
  job: Job;
  sortedBids: Bid[];
}) {
  const {
    bestValueBlend,
    bids,
    counterAnalytics,
    counterNegotiationSpark,
    setBestValueExplain,
    sideBySideWhatIf,
  } = s;
  const [sortKey, setSortKey] = useState<BidSortKey>("recommended");
  const [showInactive, setShowInactive] = useState(false);

  const valueScores = useMemo(
    () =>
      new Map((bestValueBlend?.rows ?? []).map((r) => [r.bidId, r.valueScore])),
    [bestValueBlend],
  );
  const highlights = useMemo(
    () => bidHighlights(sortedBids, bestValueBlend?.bestBidId),
    [sortedBids, bestValueBlend],
  );
  const ordered = useMemo(
    () => sortBids(sortedBids, sortKey, valueScores),
    [sortedBids, sortKey, valueScores],
  );
  const isLive = (b: Bid) => b.status === "active" || b.status === "accepted";
  const inactiveCount = ordered.filter((b) => !isLive(b)).length;
  const visible = showInactive ? ordered : ordered.filter(isLive);
  const liveCount = ordered.length - inactiveCount;
  const open = job.status === "open";
  const hasTools =
    (counterAnalytics && counterAnalytics.sent > 0) ||
    (bestValueBlend && open) ||
    !!counterNegotiationSpark ||
    (sideBySideWhatIf && open);

  return (
    <section className="card p-4 sm:p-6" aria-labelledby="bids-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="bids-heading" className="text-lg font-semibold">
            {t("Bids (")}{bids.length})
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {open
              ? t("Compare price, track record and timing, then hire. Your payment is held in (simulated) escrow and released as the work progresses.")
              : t("The bids this job received.")}
          </p>
        </div>
        {ordered.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <SlidersHorizontal
                className="h-4 w-4 text-slate-500"
                aria-hidden
              />
              <span className="sr-only sm:not-sr-only">{t("Sort")}</span>
              <select
                className="input h-9 py-0 text-sm"
                aria-label={t("Sort bids")}
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as BidSortKey)}
              >
                {BID_SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {t(o.label)}
                  </option>
                ))}
              </select>
            </label>
            {inactiveCount > 0 && (
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                />
                {t("Show withdrawn / declined (")}{inactiveCount})
              </label>
            )}
          </div>
        )}
      </div>

      {open && liveCount >= 2 && (
        <BidGlance
          bids={visible.filter(isLive)}
          highlights={highlights}
          job={job}
        />
      )}

      {hasTools && (
        <details className="group mt-4 rounded-xl ring-1 ring-slate-200 open:bg-slate-50/50">
          <summary className="cursor-pointer select-none rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {t("More comparison tools")}
            <span className="ml-1 font-normal text-slate-500">
              {t("· best-value score, negotiation timeline, payment split per bid")}
            </span>
          </summary>
          <div className="space-y-4 p-3 pt-1">
            {counterAnalytics && counterAnalytics.sent > 0 && (
              <CounterAnalyticsPanel stats={counterAnalytics} />
            )}
            {bestValueBlend && job.status === "open" && (
              <div className="rounded-xl bg-sky-50/80 p-3 ring-1 ring-sky-100">
                <h3 className="text-sm font-semibold text-slate-900">
                  {t("Best value · match + escrow")}
                  {Number(bestValueBlend.slaHeatPct ?? 0) > 0
                    ? t(" + SLA/heat")
                    : ""}
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {t("Blend of match/ranked (")}{bestValueBlend.matchPct}{t("%) and lower simulated escrow hold (")}{bestValueBlend.pricePct}%)
                  {Number(bestValueBlend.slaHeatPct ?? 0) > 0
                    ? tf(" plus response SLA + availability heat ({slaHeatPct}%)", { slaHeatPct: bestValueBlend.slaHeatPct })
                    : ""}
                  {t(". Higher is better · admin-tunable (audited).")}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {bestValueBlend.rows.map((row) => (
                    <div
                      key={row.bidId}
                      className={
                        row.bidId === bestValueBlend.bestBidId
                          ? "rounded-xl bg-white p-3 ring-2 ring-sky-400"
                          : "rounded-xl bg-white/90 p-3 ring-1 ring-sky-100"
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {row.name}
                        </p>
                        {row.bidId === bestValueBlend.bestBidId && (
                          <span className="shrink-0 rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                            {t("Best value")}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 font-mono text-lg font-bold text-sky-900">
                        {row.valueScore}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t("Match")}{" "}{row.matchScore.toFixed(0)} {t("· hold")}{" "}
                        {money(row.hold)}
                        {Number(bestValueBlend.slaHeatPct ?? 0) > 0 &&
                        row.slaHeatRaw != null
                          ? tf(" · SLA/heat {slaHeatRaw}", { slaHeatRaw: Number(row.slaHeatRaw).toFixed(0) })
                          : ""}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <a
                          href={`#bid-${row.bidId}`}
                          className="inline-block text-[11px] font-medium text-brand-700 no-underline hover:underline"
                        >
                          {t("Jump to bid")}
                        </a>
                        <button
                          type="button"
                          className="text-[11px] font-medium text-sky-800 underline-offset-2 hover:underline"
                          onClick={() =>
                            setBestValueExplain({
                              ...row,
                              isBest: row.bidId === bestValueBlend.bestBidId,
                            })
                          }
                        >
                          {t("Why this score?")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {counterNegotiationSpark && (
              <div className="rounded-xl bg-violet-50/60 p-3 ring-1 ring-violet-100">
                <h3 className="text-sm font-semibold text-slate-900">
                  {t("Counter negotiation timeline")}
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {t("Suggested amounts over time across bids on this job (sparkline).")}
                </p>
                <CounterAmountSparkline points={counterNegotiationSpark} />
                <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto text-[11px] text-slate-600">
                  {counterNegotiationSpark.map((p, i) => (
                    <li
                      key={`${p.bidId}-${p.t}-${i}`}
                      className="flex flex-wrap gap-x-2"
                    >
                      <span className="text-slate-500">
                        {fmtDateTimeFull(p.t)}
                      </span>
                      <span className="font-medium">{t(p.label)}</span>
                      <span>{money(p.amount)}</span>
                      <span className="text-slate-500">· {p.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {sideBySideWhatIf && job.status === "open" && (
              <div className="overflow-x-auto rounded-xl bg-emerald-50/70 p-3 ring-1 ring-emerald-100">
                <h3 className="text-sm font-semibold text-slate-900">
                  {t("Escrow what-if · side-by-side")}
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {t("Simulated Deposit / Progress / Completion if you accept each competing bid (no real charge).")}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {sideBySideWhatIf.map((row) => (
                    <div
                      key={row.bid.id}
                      className="rounded-xl bg-white/90 p-3 ring-1 ring-emerald-100"
                    >
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {row.name}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t("Hold")}{" "}{money(row.hold)} {t("· from")}{" "}{row.source}
                      </p>
                      <ul className="mt-2 space-y-1 text-[11px] text-slate-700">
                        {row.split.milestones.map((m) => (
                          <li
                            key={m.label}
                            className="flex justify-between gap-2"
                          >
                            <span>
                              {t(m.label)}{" "}
                              <span className="text-slate-500">
                                ({m.percent}%)
                              </span>
                            </span>
                            <span className="font-medium">
                              {money(m.amount)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <a
                        href={`#bid-${row.bid.id}`}
                        className="mt-2 inline-block text-[11px] font-medium text-brand-700 no-underline hover:underline"
                      >
                        {t("Jump to bid")}
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </details>
      )}

      <div className="mt-4">
        {sortedBids.length === 0 ? (
          <EmptyState
            title={t("No bids yet")}
            description={
              open
                ? t("Verified pros nearby usually bid within a day. Invite a few from Suggested pros above, or browse pros and invite them, to hear back sooner.")
                : t("No bids were placed on this job.")
            }
            action={
              open ? (
                <Link
                  to="/client/pros"
                  className="btn-secondary btn-sm no-underline"
                >
                  {t("Find pros")}
                </Link>
              ) : undefined
            }
          />
        ) : visible.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
            {t("All bids were withdrawn or declined.")}{" "}
            <button
              type="button"
              className="font-medium text-brand-700 underline"
              onClick={() => setShowInactive(true)}
            >
              {t("Show them")}
            </button>
          </p>
        ) : (
          <ul className="space-y-3">
            {visible.map((b) => (
              <BidCard
                key={b.id}
                s={s}
                job={job}
                b={b}
                highlights={highlights.get(b.id) ?? []}
                onExplainValue={
                  bestValueBlend?.rows.some((r) => r.bidId === b.id)
                    ? () => {
                        const row = bestValueBlend.rows.find(
                          (r) => r.bidId === b.id,
                        );
                        if (row)
                          setBestValueExplain({
                            ...row,
                            isBest: row.bidId === bestValueBlend.bestBidId,
                          });
                      }
                    : undefined
                }
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
