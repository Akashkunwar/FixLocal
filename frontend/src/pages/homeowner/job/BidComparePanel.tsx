import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { mediaUrl, type Bid, type Job } from "../../../api/jobs";
import { Badge } from "../../../components/ui/Badge";
import { ResponseSlaBadge } from "../../../components/ui/ResponseSlaBadge";
import { EmptyState } from "../../../components/ui/EmptyState";
import { StarRating } from "../../../components/ui/StarRating";
import { CounterAmountSparkline } from "./CounterAmountSparkline";
import { CounterAnalyticsPanel } from "./CounterAnalyticsPanel";
import { fmtDateTime, money } from "../../../lib/format";
import {
  previewEscrowSplit,
  escrowHoldAmount,
} from "../../../lib/escrowWhatIf";
import { DEFAULT_HOMEOWNER_COUNTER_NOTES } from "../../../lib/homeownerCounterNotes";
import type { JobDetailState } from "./useJobDetail";

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
    bestValueWeights,
    bids,
    counterAmount,
    counterAnalytics,
    counterBidId,
    counterBusy,
    counterNegotiationSpark,
    counterNotes,
    highlightBidId,
    hoNoteTemplates,
    onAccept,
    onCounterOffer,
    peerBestValueCounterHint,
    setBestValueExplain,
    setCounterAmount,
    setCounterBidId,
    setCounterNotes,
    setWhatIfCustom,
    sideBySideWhatIf,
    whatIfByBid,
    whatIfCustom,
  } = s;
  return (
    <>
      <section className="card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Bids ({bids.length})</h2>
          <p className="text-xs text-slate-500">
            Compare price · match · best value
            {Number(bestValueWeights.slaHeatPct ?? 0) > 0
              ? " (+ SLA/heat)"
              : ""}{" "}
            · escrow what-if
          </p>
        </div>

        {counterAnalytics && counterAnalytics.sent > 0 && (
          <CounterAnalyticsPanel stats={counterAnalytics} />
        )}

        {bestValueBlend && job.status === "open" && (
          <div className="mb-4 rounded-xl bg-sky-50/80 p-3 ring-1 ring-sky-100">
            <h3 className="text-sm font-semibold text-slate-900">
              Best value · match + escrow
              {Number(bestValueBlend.slaHeatPct ?? 0) > 0 ? " + SLA/heat" : ""}
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Blend of match/ranked ({bestValueBlend.matchPct}%) and lower
              simulated escrow hold ({bestValueBlend.pricePct}%)
              {Number(bestValueBlend.slaHeatPct ?? 0) > 0
                ? ` plus response SLA + availability heat (${bestValueBlend.slaHeatPct}%)`
                : ""}
              . Higher is better · admin-tunable (audited).
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
                        Best value
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-lg font-bold text-sky-900">
                    {row.valueScore}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Match {row.matchScore.toFixed(0)} · hold {money(row.hold)}
                    {Number(bestValueBlend.slaHeatPct ?? 0) > 0 &&
                    row.slaHeatRaw != null
                      ? ` · SLA/heat ${Number(row.slaHeatRaw).toFixed(0)}`
                      : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a
                      href={`#bid-${row.bidId}`}
                      className="inline-block text-[11px] font-medium text-brand-700 no-underline hover:underline"
                    >
                      Jump to bid
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
                      Why this score?
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {counterNegotiationSpark && (
          <div className="mb-4 rounded-xl bg-violet-50/60 p-3 ring-1 ring-violet-100">
            <h3 className="text-sm font-semibold text-slate-900">
              Counter negotiation timeline
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Suggested amounts over time across bids on this job (sparkline).
            </p>
            <CounterAmountSparkline points={counterNegotiationSpark} />
            <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto text-[11px] text-slate-600">
              {counterNegotiationSpark.map((p, i) => (
                <li
                  key={`${p.bidId}-${p.t}-${i}`}
                  className="flex flex-wrap gap-x-2"
                >
                  <span className="text-slate-400">
                    {new Date(p.t).toLocaleString()}
                  </span>
                  <span className="font-medium">{p.label}</span>
                  <span>{money(p.amount)}</span>
                  <span className="text-slate-400">· {p.status}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {sideBySideWhatIf && job.status === "open" && (
          <div className="mb-4 overflow-x-auto rounded-xl bg-emerald-50/70 p-3 ring-1 ring-emerald-100">
            <h3 className="text-sm font-semibold text-slate-900">
              Escrow what-if · side-by-side
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Simulated Deposit / Progress / Completion if you accept each
              competing bid (no real charge).
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
                    Hold {money(row.hold)} · from {row.source}
                  </p>
                  <ul className="mt-2 space-y-1 text-[11px] text-slate-700">
                    {row.split.milestones.map((m) => (
                      <li key={m.label} className="flex justify-between gap-2">
                        <span>
                          {m.label}{" "}
                          <span className="text-slate-400">({m.percent}%)</span>
                        </span>
                        <span className="font-medium">{money(m.amount)}</span>
                      </li>
                    ))}
                  </ul>
                  <a
                    href={`#bid-${row.bid.id}`}
                    className="mt-2 inline-block text-[11px] font-medium text-brand-700 no-underline hover:underline"
                  >
                    Jump to bid
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {sortedBids.length === 0 ? (
          <EmptyState
            title="No bids yet"
            description={
              job.status === "open"
                ? "Verified pros nearby will bid soon. You can also browse pros and invite them by sharing this job."
                : "No bids were placed on this job."
            }
            action={
              job.status === "open" ? (
                <Link
                  to="/client/pros"
                  className="btn-secondary btn-sm no-underline"
                >
                  Find pros
                </Link>
              ) : undefined
            }
          />
        ) : (
          <ul className="space-y-3">
            {sortedBids.map((b) => (
              <li
                key={b.id}
                id={`bid-${b.id}`}
                className={`rounded-xl border p-4 transition ring-offset-2 ${
                  highlightBidId === b.id
                    ? "border-amber-400 bg-amber-50/60 ring-2 ring-amber-400 shadow-md"
                    : "border-slate-200"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/pros/${b.tradespersonId}`}
                        className="font-semibold text-slate-900 no-underline hover:text-brand-700"
                      >
                        {b.tradesperson?.name ||
                          b.tradesperson?.email ||
                          "Professional"}
                      </Link>
                      {bestValueBlend?.bestBidId === b.id && (
                        <span className="rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                          Best value
                        </span>
                      )}
                      {bestValueBlend?.rows.some((r) => r.bidId === b.id) && (
                        <button
                          type="button"
                          className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800 ring-1 ring-sky-200"
                          onClick={() => {
                            const row = bestValueBlend.rows.find(
                              (r) => r.bidId === b.id,
                            );
                            if (row) {
                              setBestValueExplain({
                                ...row,
                                isBest: row.bidId === bestValueBlend.bestBidId,
                              });
                            }
                          }}
                        >
                          Why value?
                        </button>
                      )}
                      {b.matchScore != null &&
                        Number.isFinite(Number(b.matchScore)) && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 ring-1 ring-slate-200">
                            Match {(b.rankedScore ?? b.matchScore).toFixed(0)}
                            {b.heatBoost ? ` · +${b.heatBoost} heat` : ""}
                          </span>
                        )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                      {b.profile && (
                        <>
                          <StarRating
                            value={Math.round(b.profile.averageRating)}
                            readonly
                            size={14}
                          />
                          <span>({b.profile.reviewCount})</span>
                          {b.profile.city && <span>· {b.profile.city}</span>}
                          {b.profile.yearsExperience != null && (
                            <span>· {b.profile.yearsExperience} yrs</span>
                          )}
                        </>
                      )}
                      {b.responseSla && (
                        <ResponseSlaBadge sla={b.responseSla} />
                      )}
                    </div>
                    {b.proSlaTrends?.clean && (
                      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                        <span className="font-medium text-slate-600">
                          Trends
                        </span>
                        <span className="text-slate-400">7d</span>
                        <ResponseSlaBadge sla={b.proSlaTrends.d7} compact />
                        <span className="text-slate-400">30d</span>
                        <ResponseSlaBadge sla={b.proSlaTrends.d30} compact />
                      </p>
                    )}
                    {b.message && (
                      <p className="mt-2 text-sm text-slate-600">{b.message}</p>
                    )}
                    {b.etaDays != null && (
                      <p className="mt-1 text-xs text-slate-400">
                        ETA: {b.etaDays} day(s)
                      </p>
                    )}
                    {b.proposedVisitStart && (
                      <p className="mt-1 text-xs text-brand-700">
                        Proposed visit: {fmtDateTime(b.proposedVisitStart)}
                        {b.proposedVisitEnd
                          ? ` – ${fmtDateTime(b.proposedVisitEnd)}`
                          : ""}
                      </p>
                    )}
                    {(b.quoteAmount != null ||
                      b.quoteNotes ||
                      b.quoteAttachmentUrl ||
                      (b.quoteHistory && b.quoteHistory.length > 0)) && (
                      <div className="mt-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                          Quote / estimate
                          {b.quoteHistory && b.quoteHistory.length > 0
                            ? ` · ${b.quoteHistory.length} revision${b.quoteHistory.length === 1 ? "" : "s"}`
                            : ""}
                        </p>
                        {b.quoteAmount != null && (
                          <div className="mt-1 flex flex-wrap items-baseline gap-2">
                            <p className="text-base font-bold text-amber-950">
                              {money(b.quoteAmount)}
                            </p>
                            {(() => {
                              const hist = b.quoteHistory || [];
                              if (!hist.length) return null;
                              const prev = hist[hist.length - 1];
                              if (prev?.amount == null) return null;
                              const delta =
                                Number(b.quoteAmount) - Number(prev.amount);
                              if (!Number.isFinite(delta) || delta === 0) {
                                return (
                                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                                    no amount change
                                  </span>
                                );
                              }
                              const down = delta < 0;
                              return (
                                <span
                                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                    down
                                      ? "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200"
                                      : "bg-rose-100 text-rose-900 ring-1 ring-rose-200"
                                  }`}
                                >
                                  {down ? "↓" : "↑"} {down ? "" : "+"}
                                  {money(delta)} vs prior
                                </span>
                              );
                            })()}
                          </div>
                        )}
                        {b.quoteNotes && (
                          <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">
                            {b.quoteNotes}
                          </p>
                        )}
                        {b.quoteAttachmentUrl && (
                          <a
                            href={mediaUrl(b.quoteAttachmentUrl)}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block text-xs font-medium text-brand-700 underline"
                          >
                            Open quote attachment
                          </a>
                        )}
                        {b.quoteHistory && b.quoteHistory.length > 0 && (
                          <div className="mt-2 border-t border-amber-200/80 pt-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                              Revision diff
                            </p>
                            <ul className="mt-1 space-y-1.5">
                              {(() => {
                                const hist = [...b.quoteHistory];
                                const timeline = [
                                  ...hist.map((h) => ({
                                    amount: h.amount,
                                    notes: h.notes,
                                    at: h.revisedAt,
                                    kind: "prior" as const,
                                  })),
                                  {
                                    amount:
                                      b.quoteAmount != null
                                        ? Number(b.quoteAmount)
                                        : null,
                                    notes: b.quoteNotes || null,
                                    at: null as string | null,
                                    kind: "current" as const,
                                  },
                                ];
                                const rows: ReactNode[] = [];
                                for (let i = timeline.length - 1; i >= 1; i--) {
                                  const cur = timeline[i];
                                  const prev = timeline[i - 1];
                                  const dAmt =
                                    cur.amount != null && prev.amount != null
                                      ? Number(cur.amount) - Number(prev.amount)
                                      : null;
                                  const notesChanged =
                                    (cur.notes || null) !==
                                    (prev.notes || null);
                                  rows.push(
                                    <li
                                      key={`${prev.at || "x"}-${i}`}
                                      className="rounded-lg bg-white/70 px-2 py-1.5 text-[11px] text-slate-600 ring-1 ring-amber-100"
                                    >
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-medium text-slate-800">
                                          {prev.amount != null
                                            ? money(prev.amount)
                                            : "—"}
                                          {" → "}
                                          {cur.amount != null
                                            ? money(cur.amount)
                                            : "—"}
                                        </span>
                                        {dAmt != null && dAmt !== 0 && (
                                          <span
                                            className={
                                              dAmt < 0
                                                ? "font-semibold text-emerald-700"
                                                : "font-semibold text-rose-700"
                                            }
                                          >
                                            ({dAmt > 0 ? "+" : ""}
                                            {money(dAmt)})
                                          </span>
                                        )}
                                        {cur.kind === "current" ? (
                                          <span className="rounded-sm bg-amber-100 px-1 text-[9px] uppercase text-amber-900">
                                            latest
                                          </span>
                                        ) : null}
                                        {prev.at && (
                                          <span className="text-slate-400">
                                            {new Date(prev.at).toLocaleString()}
                                          </span>
                                        )}
                                      </div>
                                      {notesChanged && (
                                        <div className="mt-0.5 space-y-0.5 text-slate-500">
                                          <p className="truncate">
                                            <span className="text-slate-400">
                                              was:
                                            </span>{" "}
                                            {prev.notes
                                              ? `“${prev.notes}”`
                                              : "—"}
                                          </p>
                                          <p className="truncate">
                                            <span className="text-slate-400">
                                              now:
                                            </span>{" "}
                                            {cur.notes ? `“${cur.notes}”` : "—"}
                                          </p>
                                        </div>
                                      )}
                                    </li>,
                                  );
                                }
                                return rows;
                              })()}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                    {b.distanceKm != null && (
                      <p className="mt-1 text-xs text-slate-500">
                        ~{b.distanceKm} km from job
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-slate-900">
                      {money(b.amount)}
                    </p>
                    <Badge status={b.status} />
                    {job.status === "open" && b.status === "active" && (
                      <button
                        type="button"
                        className="btn-primary btn-sm mt-2"
                        onClick={() => onAccept(b.id)}
                      >
                        {b.quoteAmount != null && Number(b.quoteAmount) > 0
                          ? "Accept quote → escrow"
                          : "Accept → escrow"}
                      </button>
                    )}
                    {job.status === "open" &&
                      b.status === "active" &&
                      b.quoteAmount != null &&
                      Number(b.quoteAmount) > 0 && (
                        <p className="mt-1 max-w-40 text-[11px] text-slate-500">
                          Escrow will use quote {money(b.quoteAmount)}
                        </p>
                      )}
                    {job.status === "open" && b.status === "active" && (
                      <button
                        type="button"
                        className="btn-secondary btn-sm mt-2"
                        onClick={() => {
                          setCounterBidId(b.id);
                          const base =
                            b.quoteAmount != null && Number(b.quoteAmount) > 0
                              ? Number(b.quoteAmount)
                              : Number(b.amount);
                          setCounterAmount(
                            Number.isFinite(base)
                              ? String(Math.max(1, Math.round(base * 0.9)))
                              : "",
                          );
                          setCounterNotes("");
                        }}
                      >
                        Request revise
                      </button>
                    )}
                    {b.counterOffer && (
                      <p className="mt-2 max-w-48 text-[11px] text-slate-600">
                        Counter {money(b.counterOffer.suggestedAmount)}
                        <span className="text-slate-400">
                          {" "}
                          · {b.counterOffer.status}
                        </span>
                      </p>
                    )}
                    {Array.isArray(b.counterHistory) &&
                      b.counterHistory.length > 0 && (
                        <details className="mt-1 max-w-56 text-left">
                          <summary className="cursor-pointer text-[10px] text-slate-500">
                            Counter history ({b.counterHistory.length})
                          </summary>
                          <ul className="mt-1 space-y-0.5 text-[10px] text-slate-600">
                            {[...b.counterHistory]
                              .reverse()
                              .slice(0, 5)
                              .map((h, i) => (
                                <li key={`${h.requestedAt}-${i}`}>
                                  {money(h.suggestedAmount)} · {h.status}
                                  <span className="text-slate-400">
                                    {" "}
                                    · {new Date(h.requestedAt).toLocaleString()}
                                  </span>
                                </li>
                              ))}
                          </ul>
                        </details>
                      )}
                    {b.counterOffer?.status === "addressed" &&
                      b.quoteAmount != null &&
                      Math.abs(
                        Number(b.quoteAmount) -
                          Number(b.counterOffer.suggestedAmount),
                      ) >= 1 && (
                        <p className="mt-1 max-w-48 text-[10px] text-amber-800">
                          Soft escrow preview: hold {money(b.quoteAmount)}{" "}
                          (counter was {money(b.counterOffer.suggestedAmount)})
                        </p>
                      )}
                  </div>
                </div>
                {(b.status === "active" || b.status === "accepted") &&
                  (() => {
                    const custom = whatIfCustom[b.id];
                    const customN =
                      custom != null && custom !== "" ? Number(custom) : NaN;
                    const api = whatIfByBid[b.id];
                    const defaultHold = escrowHoldAmount(b);
                    const hold =
                      Number.isFinite(customN) && customN > 0
                        ? customN
                        : (api?.amount ?? defaultHold);
                    const split =
                      api && Math.abs(Number(api.amount) - hold) < 0.02
                        ? { amount: api.amount, milestones: api.milestones }
                        : previewEscrowSplit(hold);
                    if (!(hold > 0) || split.milestones.length !== 3)
                      return null;
                    return (
                      <div className="mt-3 rounded-xl bg-emerald-50/60 p-3 ring-1 ring-emerald-100">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-emerald-950">
                            Escrow what-if{" "}
                            <span className="font-normal text-emerald-800/80">
                              (simulated · {money(hold)})
                            </span>
                          </p>
                          {job.status === "open" && b.status === "active" && (
                            <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                              <span>Try ₹</span>
                              <input
                                className="input h-7 w-24 py-0 text-xs"
                                type="number"
                                min={1}
                                placeholder={String(Math.round(defaultHold))}
                                value={whatIfCustom[b.id] ?? ""}
                                onChange={(e) =>
                                  setWhatIfCustom((prev) => ({
                                    ...prev,
                                    [b.id]: e.target.value,
                                  }))
                                }
                              />
                            </label>
                          )}
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          {split.milestones.map((m) => (
                            <div
                              key={m.label}
                              className="rounded-lg bg-white/80 px-2 py-1.5 text-center ring-1 ring-emerald-100"
                            >
                              <p className="text-[10px] uppercase tracking-wide text-slate-400">
                                {m.label}
                              </p>
                              <p className="text-sm font-bold text-slate-900">
                                {money(m.amount)}
                              </p>
                              <p className="text-[10px] text-slate-400">
                                {m.percent}%
                              </p>
                            </div>
                          ))}
                        </div>
                        {api?.note && (
                          <p className="mt-1.5 text-[10px] text-slate-500">
                            {api.note}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                {(() => {
                  const points = (counterNegotiationSpark || []).filter(
                    (p) => p.bidId === b.id,
                  );
                  if (!points || points.length < 2) return null;
                  return (
                    <div className="mt-3 rounded-xl bg-violet-50/50 p-2.5 ring-1 ring-violet-100">
                      <p className="text-[11px] font-semibold text-slate-800">
                        This bid · counter sparkline
                      </p>
                      <CounterAmountSparkline points={points} />
                    </div>
                  );
                })()}
                {counterBidId === b.id &&
                  job.status === "open" &&
                  b.status === "active" && (
                    <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                      <p className="text-xs font-semibold text-slate-800">
                        Counter-offer / request revise
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Suggest an amount and notes. The pro is notified
                        (simulated).
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(() => {
                          const base =
                            b.quoteAmount != null && Number(b.quoteAmount) > 0
                              ? Number(b.quoteAmount)
                              : Number(b.amount);
                          if (!Number.isFinite(base) || base <= 0) return null;
                          const presets = [
                            {
                              label: "−10%",
                              value: Math.max(1, Math.round(base * 0.9)),
                            },
                            {
                              label: "−15%",
                              value: Math.max(1, Math.round(base * 0.85)),
                            },
                            {
                              label: "−20%",
                              value: Math.max(1, Math.round(base * 0.8)),
                            },
                          ];
                          return presets.map((p) => (
                            <button
                              key={p.label}
                              type="button"
                              className="btn-ghost btn-sm text-[11px]"
                              onClick={() => setCounterAmount(String(p.value))}
                            >
                              Suggested {p.label} · ₹{p.value}
                            </button>
                          ));
                        })()}
                        {peerBestValueCounterHint && (
                          <button
                            type="button"
                            className="btn-ghost btn-sm text-[11px] text-sky-800 ring-1 ring-sky-200"
                            title={`Soft hint from peer best-value hold (avg peers ₹${peerBestValueCounterHint.avgHold})`}
                            onClick={() =>
                              setCounterAmount(
                                String(peerBestValueCounterHint.suggested),
                              )
                            }
                          >
                            Peer best-value · ₹
                            {peerBestValueCounterHint.suggested}
                            {peerBestValueCounterHint.isBestPeer
                              ? ` (${peerBestValueCounterHint.peerName})`
                              : ""}
                          </button>
                        )}
                      </div>
                      {peerBestValueCounterHint && (
                        <p className="mt-1.5 text-[10px] text-sky-800/80">
                          Soft hint from clean peer best-value holds
                          {peerBestValueCounterHint.isBestPeer
                            ? ` — ${peerBestValueCounterHint.peerName}`
                            : ""}{" "}
                          (avg top peers ₹{peerBestValueCounterHint.avgHold}).
                          Simulated only.
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(hoNoteTemplates.length
                          ? hoNoteTemplates
                          : DEFAULT_HOMEOWNER_COUNTER_NOTES
                        ).map((tpl) => (
                          <button
                            key={tpl.id}
                            type="button"
                            className="btn-ghost btn-sm text-[11px]"
                            title={tpl.body}
                            onClick={() => setCounterNotes(tpl.body)}
                          >
                            {tpl.label}
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <input
                          className="input w-36"
                          type="number"
                          min={1}
                          placeholder="Suggested ₹"
                          value={counterAmount}
                          onChange={(e) => setCounterAmount(e.target.value)}
                        />
                        <input
                          className="input min-w-[180px] flex-1"
                          placeholder="Notes (optional)"
                          value={counterNotes}
                          onChange={(e) => setCounterNotes(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          disabled={counterBusy}
                          onClick={() => onCounterOffer(b.id)}
                        >
                          {counterBusy ? "Sending…" : "Send to pro"}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => setCounterBidId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
