import { RatingStar } from "../../../components/ui/RatingStar";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, CalendarClock, Clock, MapPin, Quote } from "lucide-react";
import { mediaUrl, type Bid, type Job } from "../../../api/jobs";
import { Badge } from "../../../components/ui/Badge";
import { ResponseSlaBadge } from "../../../components/ui/ResponseSlaBadge";
import { StarRating } from "../../../components/ui/StarRating";
import { CounterAmountSparkline } from "./CounterAmountSparkline";
import { fmtDateTime, initials, money, fmtDateTimeFull } from "../../../lib/format";
import {
  previewEscrowSplit,
  escrowHoldAmount,
} from "../../../lib/escrowWhatIf";
import { DEFAULT_HOMEOWNER_COUNTER_NOTES } from "../../../lib/homeownerCounterNotes";
import {
  HIGHLIGHT_LABEL,
  budgetFit,
  effectivePrice,
  skillList,
  type BidHighlight,
} from "../../../lib/bidCompare";
import type { JobDetailState } from "./useJobDetail";
import { t, tf, plural } from "../../../lib/i18n";

const HIGHLIGHT_STYLE: Record<BidHighlight, string> = {
  best_value: "bg-sky-600 text-white",
  lowest_price: "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200",
  top_rated: "bg-amber-100 text-amber-900 ring-1 ring-amber-200",
  fastest: "bg-violet-100 text-violet-900 ring-1 ring-violet-200",
  most_experienced: "bg-slate-100 text-slate-800 ring-1 ring-slate-200",
};

export function HighlightChips({ tags }: { tags: BidHighlight[] }) {
  if (!tags.length) return null;
  return (
    <>
      {tags.map((tag) => (
        <span
          key={tag}
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${HIGHLIGHT_STYLE[tag]}`}
        >
          {t(HIGHLIGHT_LABEL[tag])}
        </span>
      ))}
    </>
  );
}

export function ProAvatar({ b, size = 44 }: { b: Bid; size?: number }) {
  const name = b.tradesperson?.name || "Professional";
  return b.profile?.avatarUrl ? (
    <img
      src={mediaUrl(b.profile.avatarUrl)}
      alt=""
      className="shrink-0 rounded-full object-cover ring-1 ring-slate-200"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800"
      style={{ width: size, height: size, fontSize: size / 2.8 }}
    >
      {initials(name)}
    </span>
  );
}

function Fact({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1">{children}</span>;
}

export function BidCard({
  s,
  job,
  b,
  highlights,
  onExplainValue,
}: {
  s: JobDetailState;
  job: Job;
  b: Bid;
  highlights: BidHighlight[];
  onExplainValue?: () => void;
}) {
  const {
    counterAmount,
    counterBidId,
    counterBusy,
    counterNegotiationSpark,
    counterNotes,
    highlightBidId,
    hoNoteTemplates,
    onAccept,
    onCounterOffer,
    peerBestValueCounterHint,
    setCounterAmount,
    setCounterBidId,
    setCounterNotes,
    setWhatIfCustom,
    whatIfByBid,
    whatIfCustom,
  } = s;
  const p = b.profile;
  const price = effectivePrice(b);
  const fit = budgetFit(price, job.budgetMin, job.budgetMax);
  const canAct = job.status === "open" && b.status === "active";
  const hasQuote = b.quoteAmount != null && Number(b.quoteAmount) > 0;
  const skills = skillList(p?.skills);
  const hasHistory =
    (b.quoteHistory && b.quoteHistory.length > 0) ||
    (Array.isArray(b.counterHistory) && b.counterHistory.length > 0) ||
    b.status === "active" ||
    b.status === "accepted";

  return (
    <li
      id={`bid-${b.id}`}
      className={`scroll-mt-24 rounded-xl border p-4 transition ring-offset-2 ${
        highlightBidId === b.id
          ? "border-amber-400 bg-amber-50/60 ring-2 ring-amber-400 shadow-md"
          : b.status === "accepted"
            ? "border-emerald-300 bg-emerald-50/40"
            : "border-slate-200"
      } ${b.status === "withdrawn" || b.status === "rejected" ? "opacity-70" : ""}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {/* Who */}
          <div className="flex items-start gap-3">
            <ProAvatar b={b} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <Link
                  to={`/pros/${b.tradespersonId}`}
                  className="font-semibold text-slate-900 no-underline hover:text-brand-700"
                >
                  {b.tradesperson?.name ||
                    b.tradesperson?.email ||
                    t("Professional")}
                </Link>
                {p?.verificationStatus === "verified" && (
                  <span
                    className="inline-flex items-center gap-0.5 text-[11px] font-medium text-emerald-700"
                    title={t("ID and licence checked by FixLocal")}
                  >
                    <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> {t("Verified")}
                  </span>
                )}
                <HighlightChips tags={highlights} />
                {onExplainValue && (
                  <button
                    type="button"
                    className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800 ring-1 ring-sky-200"
                    onClick={onExplainValue}
                  >
                    {t("Why value?")}
                  </button>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-slate-500">
                {p && p.reviewCount > 0 ? (
                  <Fact>
                    <StarRating
                      value={Math.round(p.averageRating)}
                      readonly
                      size={13}
                    />
                    <span className="font-medium text-slate-700">
                      {p.averageRating.toFixed(1)}
                    </span>
                    <span>
                      ({plural(p.reviewCount, "{n} review", "{n} reviews")})
                    </span>
                  </Fact>
                ) : (
                  <span className="text-slate-500">{t("No reviews yet")}</span>
                )}
                {p?.completedJobs != null && (
                  <Fact>
                    {plural(p.completedJobs, "{n} job done", "{n} jobs done")}
                  </Fact>
                )}
                {p?.yearsExperience != null && (
                  <Fact>{p.yearsExperience} {t("yrs exp.")}</Fact>
                )}
                {(b.distanceKm != null || p?.city) && (
                  <Fact>
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    {b.distanceKm != null
                      ? tf("~{distanceKm} km away", { distanceKm: b.distanceKm })
                      : p?.city}
                  </Fact>
                )}
                {b.responseSla && <ResponseSlaBadge sla={b.responseSla} />}
              </div>
              {b.matchScore != null &&
                Number.isFinite(Number(b.matchScore)) && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    {t("Match score")}{" "}{(b.rankedScore ?? b.matchScore).toFixed(0)} {t("for this job")}
                    {b.heatBoost ? tf(" · +{heatBoost} availability", { heatBoost: b.heatBoost }) : ""}
                  </p>
                )}
            </div>
          </div>

          {skills.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t("Skills")}>
              {skills.map((sk) => (
                <li
                  key={sk}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700"
                >
                  {sk}
                </li>
              ))}
            </ul>
          )}

          {/* What they said */}
          {b.message && (
            <p className="mt-3 text-sm text-slate-700 whitespace-pre-wrap">
              {b.message}
            </p>
          )}

          {(hasQuote || b.quoteNotes || b.quoteAttachmentUrl) && (
            <div className="mt-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                {t("Quote / estimate")}
                {b.quoteHistory && b.quoteHistory.length > 0
                  ? " · " + plural(b.quoteHistory.length, "{n} revision", "{n} revisions")
                  : ""}
              </p>
              {hasQuote && (
                <p className="mt-1 text-base font-bold text-amber-950">
                  {money(b.quoteAmount)}
                </p>
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
                  {t("Open quote attachment")}
                </a>
              )}
            </div>
          )}

          {/* Proof of work */}
          {p?.latestReview && (
            <figure className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-100">
              <blockquote className="flex gap-2 text-slate-600">
                <Quote
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300"
                  aria-hidden
                />
                <span className="line-clamp-2">{p.latestReview.comment}</span>
              </blockquote>
              <figcaption className="mt-1 text-[11px] text-slate-500">
                {t("Latest review ·")}{" "}{p.latestReview.rating}
                <RatingStar className="ml-0.5" />
              </figcaption>
            </figure>
          )}
          {!p?.latestReview && p?.bio && (
            <p className="mt-3 line-clamp-2 text-sm text-slate-500">{p.bio}</p>
          )}
          {p?.galleryPreview && p.galleryPreview.length > 0 && (
            <div className="mt-3 flex gap-2" aria-label={t("Recent work")}>
              {p.galleryPreview.map((u) => (
                <Link
                  key={u}
                  to={`/pros/${b.tradespersonId}`}
                  aria-label={t("See portfolio")}
                >
                  <img
                    src={mediaUrl(u)}
                    alt=""
                    loading="lazy"
                    className="h-14 w-14 rounded-lg object-cover ring-1 ring-slate-200 sm:h-16 sm:w-16"
                  />
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Price + decision */}
        <div className="flex shrink-0 flex-col gap-1.5 border-t border-slate-100 pt-3 sm:w-52 sm:items-end sm:border-0 sm:pt-0 sm:text-right">
          <div className="flex items-baseline justify-between gap-2 sm:block">
            <p className="text-2xl font-bold text-slate-900">{money(price)}</p>
            <Badge status={b.status} />
          </div>
          {hasQuote &&
            Math.abs(Number(b.quoteAmount) - Number(b.amount)) >= 1 && (
              <p className="text-[11px] text-slate-500">
                {t("Quote · original bid")}{" "}{money(b.amount)}
              </p>
            )}
          {fit && (
            <p
              className={`text-xs font-medium ${
                fit.kind === "over"
                  ? "text-rose-700"
                  : fit.kind === "within"
                    ? "text-emerald-700"
                    : "text-slate-600"
              }`}
            >
              {fit.kind === "within"
                ? t("Within your budget")
                : fit.kind === "over"
                  ? tf("{by} over budget", { by: money(fit.by) })
                  : tf("{by} under budget", { by: money(fit.by) })}
            </p>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 sm:justify-end">
            {b.etaDays != null && (
              <Fact>
                <Clock className="h-3.5 w-3.5" aria-hidden />
                {plural(b.etaDays, "Done in {n} day", "Done in {n} days")}
              </Fact>
            )}
            {b.proposedVisitStart && (
              <Fact>
                <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                {t("Visit")}{" "}{fmtDateTime(b.proposedVisitStart)}
              </Fact>
            )}
          </div>
          {canAct && (
            <div className="mt-1 flex gap-2 sm:flex-col sm:items-stretch">
              <button
                type="button"
                className="btn-primary btn-sm flex-1 touch-target"
                onClick={() => onAccept(b.id)}
              >
                {t("Accept & hire")}
                <span className="hidden sm:inline"> · {money(price)}</span>
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm flex-1 touch-target"
                onClick={() => {
                  setCounterBidId(b.id);
                  const base = hasQuote
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
                {t("Request revise")}
              </button>
            </div>
          )}
          {canAct && (
            <p className="text-[11px] text-slate-500">
              {money(price)} {t("goes into escrow; you release it in 3 steps.")}
            </p>
          )}
          {b.counterOffer && (
            <p className="text-[11px] text-slate-600">
              {t("Your counter")}{" "}{money(b.counterOffer.suggestedAmount)}
              <span className="text-slate-500"> · {b.counterOffer.status}</span>
            </p>
          )}
          {b.counterOffer?.status === "addressed" &&
            b.quoteAmount != null &&
            Math.abs(
              Number(b.quoteAmount) - Number(b.counterOffer.suggestedAmount),
            ) >= 1 && (
              <p className="mt-1 max-w-48 text-[10px] text-amber-800">
                {t("Soft escrow preview: hold")}{" "}{money(b.quoteAmount)} {t("(counter was")}{" "}
                {money(b.counterOffer.suggestedAmount)})
              </p>
            )}
        </div>
      </div>

      {hasHistory && (
        <details className="mt-3 rounded-xl ring-1 ring-slate-100">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
            {t("Quote history & payment split")}
          </summary>
          <div className="px-3 pb-3">
            {b.quoteHistory && b.quoteHistory.length > 0 && (
              <div className="mt-2 border-t border-amber-200/80 pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                  {t("Revision diff")}
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
                          b.quoteAmount != null ? Number(b.quoteAmount) : null,
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
                        (cur.notes || null) !== (prev.notes || null);
                      rows.push(
                        <li
                          key={`${prev.at || "x"}-${i}`}
                          className="rounded-lg bg-white/70 px-2 py-1.5 text-[11px] text-slate-600 ring-1 ring-amber-100"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-slate-800">
                              {prev.amount != null ? money(prev.amount) : "—"}
                              {" → "}
                              {cur.amount != null ? money(cur.amount) : "—"}
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
                                {t("latest")}
                              </span>
                            ) : null}
                            {prev.at && (
                              <span className="text-slate-500">
                                {fmtDateTimeFull(prev.at)}
                              </span>
                            )}
                          </div>
                          {notesChanged && (
                            <div className="mt-0.5 space-y-0.5 text-slate-500">
                              <p className="truncate">
                                <span className="text-slate-500">{t("was:")}</span>{" "}
                                {prev.notes ? `“${prev.notes}”` : "—"}
                              </p>
                              <p className="truncate">
                                <span className="text-slate-500">{t("now:")}</span>{" "}
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
            {Array.isArray(b.counterHistory) && b.counterHistory.length > 0 && (
              <details className="mt-1 max-w-56 text-left">
                <summary className="cursor-pointer text-[10px] text-slate-500">
                  {t("Counter history (")}{b.counterHistory.length})
                </summary>
                <ul className="mt-1 space-y-0.5 text-[10px] text-slate-600">
                  {[...b.counterHistory]
                    .reverse()
                    .slice(0, 5)
                    .map((h, i) => (
                      <li key={`${h.requestedAt}-${i}`}>
                        {money(h.suggestedAmount)} · {h.status}
                        <span className="text-slate-500">
                          {" "}
                          · {fmtDateTimeFull(h.requestedAt)}
                        </span>
                      </li>
                    ))}
                </ul>
              </details>
            )}
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
                if (!(hold > 0) || split.milestones.length !== 3) return null;
                return (
                  <div className="mt-3 rounded-xl bg-emerald-50/60 p-3 ring-1 ring-emerald-100">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-emerald-950">
                        {t("Escrow what-if")}{" "}
                        <span className="font-normal text-emerald-800">
                          {t("(simulated ·")}{" "}{money(hold)})
                        </span>
                      </p>
                      {job.status === "open" && b.status === "active" && (
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                          <span>{t("Try ₹")}</span>
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
                          <p className="text-[10px] uppercase tracking-wide text-slate-500">
                            {t(m.label)}
                          </p>
                          <p className="text-sm font-bold text-slate-900">
                            {money(m.amount)}
                          </p>
                          <p className="text-[10px] text-slate-500">
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
                    {t("This bid · counter sparkline")}
                  </p>
                  <CounterAmountSparkline points={points} />
                </div>
              );
            })()}
            {(() => {
              const points = (counterNegotiationSpark || []).filter(
                (pt) => pt.bidId === b.id,
              );
              if (!points || points.length < 2) return null;
              return (
                <div className="mt-3 rounded-xl bg-violet-50/50 p-2.5 ring-1 ring-violet-100">
                  <p className="text-[11px] font-semibold text-slate-800">
                    {t("This bid · counter sparkline")}
                  </p>
                  <CounterAmountSparkline points={points} />
                </div>
              );
            })()}
          </div>
        </details>
      )}
      {counterBidId === b.id &&
        job.status === "open" &&
        b.status === "active" && (
          <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-xs font-semibold text-slate-800">
              {t("Counter-offer / request revise")}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {t("Suggest an amount and notes. The pro is notified (simulated).")}
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
                    {t("Suggested")}{" "}{t(p.label)} · ₹{p.value}
                  </button>
                ));
              })()}
              {peerBestValueCounterHint && (
                <button
                  type="button"
                  className="btn-ghost btn-sm text-[11px] text-sky-800 ring-1 ring-sky-200"
                  title={tf("Soft hint from peer best-value hold (avg peers ₹{avgHold})", { avgHold: peerBestValueCounterHint.avgHold })}
                  onClick={() =>
                    setCounterAmount(String(peerBestValueCounterHint.suggested))
                  }
                >
                  {t("Peer best-value · ₹")}{peerBestValueCounterHint.suggested}
                  {peerBestValueCounterHint.isBestPeer
                    ? ` (${peerBestValueCounterHint.peerName})`
                    : ""}
                </button>
              )}
            </div>
            {peerBestValueCounterHint && (
              <p className="mt-1.5 text-[10px] text-sky-800">
                {t("Soft hint from clean peer best-value holds")}
                {peerBestValueCounterHint.isBestPeer
                  ? ` — ${peerBestValueCounterHint.peerName}`
                  : ""}{" "}
                {t("(avg top peers ₹")}{peerBestValueCounterHint.avgHold}{t("). Simulated only.")}
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
                  {t(tpl.label)}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                className="input w-36"
                type="number"
                min={1}
                placeholder={t("Suggested ₹")}
                value={counterAmount}
                onChange={(e) => setCounterAmount(e.target.value)}
              />
              <input
                className="input min-w-[180px] flex-1"
                placeholder={t("Notes (optional)")}
                value={counterNotes}
                onChange={(e) => setCounterNotes(e.target.value)}
              />
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={counterBusy}
                onClick={() => onCounterOffer(b.id)}
              >
                {counterBusy ? t("Sending…") : t("Send to pro")}
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setCounterBidId(null)}
              >
                {t("Cancel")}
              </button>
            </div>
          </div>
        )}
    </li>
  );
}
