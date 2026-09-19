import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Shell } from "../../components/Shell";
import {
  createDispute,
  markJobDone,
  getJob,
  listBids,
  mediaUrl,
  placeBid,
  updateBidQuote,
  startJob,
  withdrawBid,
  getProfile,
  declineJobInvite,
  markInviteOpened,
  declineCounterOffer,
  type Bid,
  type Job,
} from "../../api/jobs";
import { JobChat } from "../../components/JobChat";
import { PaymentPanel } from "../../components/PaymentPanel";
import { CompletionPhotosPanel } from "../../components/CompletionPhotosPanel";
import { AmcProposalCard } from "../../components/AmcProposalCard";
import { SchedulePanel } from "../../components/SchedulePanel";
import { ProVisitDayCard } from "../../components/ProVisitDayCard";
import { cadenceLabel, normalizeCadence } from "../../lib/jobCadence";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { StatusTimeline } from "../../components/ui/StatusTimeline";
import { useToast } from "../../components/Toast";
import { useAuth } from "../../auth/AuthContext";
import { categoryLabel, fmtDate, fmtDateTime, money } from "../../lib/format";
import { addFavorite, createReview, getJobReview, type JobReview } from "../../api/extras";
import { ApiError } from "../../api/client";
import { ReportButton } from "../../components/ReportButton";
import { StarRating } from "../../components/ui/StarRating";
import { Heart } from "lucide-react";
import { mergeCounterTemplates } from "../../lib/counterTemplates";
import {
  normalizeWeeklyAvailability,
  type WeeklyAvailability,
} from "../../lib/availability";
import {
  softRatePackages,
  formatCustomPackage,
  type CustomRatePackage,
} from "../../lib/ratePackages";

const DECLINE_CHIPS: { id: string; label: string }[] = [
  { id: "busy", label: "Busy" },
  { id: "schedule", label: "Schedule conflict" },
  { id: "too_far", label: "Too far" },
  { id: "rate", label: "Rate mismatch" },
  { id: "specialty", label: "Not my specialty" },
  { id: "other", label: "Other" },
];

export function ProJobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { success, error } = useToast();
  const [job, setJob] = useState<Job | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteBanner, setInviteBanner] = useState(false);
  const [declineBusy, setDeclineBusy] = useState(false);
  const [showDeclineSheet, setShowDeclineSheet] = useState(false);
  const [declineReason, setDeclineReason] = useState<string>("");
  const [declineNote, setDeclineNote] = useState("");
  const bidFormRef = useRef<HTMLFormElement | null>(null);
  const fromInvite = useMemo(
    () => searchParams.get("invite") === "1" || window.location.hash === "#bid-form",
    [searchParams]
  );
  const fromCounter = useMemo(() => searchParams.get("counter") === "1", [searchParams]);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [etaDays, setEtaDays] = useState("1");
  const [visitStart, setVisitStart] = useState("");
  const [visitEnd, setVisitEnd] = useState("");
  const [quoteAmount, setQuoteAmount] = useState("");
  const [quoteNotes, setQuoteNotes] = useState("");
  const [quoteFile, setQuoteFile] = useState<File | null>(null);
  const [quoteEditAmount, setQuoteEditAmount] = useState("");
  const [quoteEditNotes, setQuoteEditNotes] = useState("");
  const [quoteEditBusy, setQuoteEditBusy] = useState(false);
  const [showQuoteEdit, setShowQuoteEdit] = useState(false);
  const [proAvailability, setProAvailability] = useState<WeeklyAvailability | null>(null);
  const [amcCustomPackages, setAmcCustomPackages] = useState<
    NonNullable<import("../../api/jobs").TradespersonProfile["customRatePackages"]>
  >([]);
  const [amcHourlyMin, setAmcHourlyMin] = useState<string | number | null>(null);
  const [amcHourlyMax, setAmcHourlyMax] = useState<string | number | null>(null);
  const [showCounterDecline, setShowCounterDecline] = useState(false);
  const [counterDeclineTplId, setCounterDeclineTplId] = useState<string | null>(null);
  const [counterDeclineNote, setCounterDeclineNote] = useState("");
  const [counterDeclineFloor, setCounterDeclineFloor] = useState("");
  const [counterDeclineBusy, setCounterDeclineBusy] = useState(false);

  const [otherBidCount, setOtherBidCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clientReview, setClientReview] = useState<JobReview | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeFiles, setDisputeFiles] = useState<File[]>([]);

  async function load() {
    if (!id) return;
    if (!job) setLoading(true);
    try {
      const j = await getJob(id);
      // Pros only see their own bid; no bid yet is a normal state.
      const b = await listBids(id).catch((e) => {
        if (e instanceof ApiError && e.status === 403) return { bids: [] as Bid[], otherActiveBidCount: undefined };
        throw e;
      });
      setJob(j.job);
      setBids(b.bids);
      setOtherBidCount(b.otherActiveBidCount ?? 0);
      setLoadError(null);
      if (j.job.status === "completed" && j.access === "private") {
        getJobReview(id)
          .then((r) => setClientReview(r.proReview))
          .catch(() => setClientReview(null));
      }
    } catch (e) {
      const err = e as ApiError;
      setLoadError(
        err.code === "NOT_VERIFIED"
          ? "Your professional account needs to be verified by FixLocal before you can view job details."
          : err.message
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    getProfile()
      .then((r) => {
        setProAvailability(
          r.profile.weeklyAvailability
            ? normalizeWeeklyAvailability(r.profile.weeklyAvailability)
            : null
        );
        setAmcCustomPackages(
          Array.isArray(r.profile.customRatePackages)
            ? r.profile.customRatePackages
            : []
        );
        setAmcHourlyMin(r.profile.hourlyRateMin ?? null);
        setAmcHourlyMax(r.profile.hourlyRateMax ?? null);
      })
      .catch(() => {
        setProAvailability(null);
        setAmcCustomPackages([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the job id changes
  }, [id]);

  useEffect(() => {
    if (!fromInvite) return;
    setInviteBanner(true);
    const t = window.setTimeout(() => {
      bidFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 250);
    return () => clearTimeout(t);
  }, [fromInvite, loading, id]);

  useEffect(() => {
    if (!fromInvite || !id || loading) return;
    markInviteOpened(id).catch(() => {
      /* no pending invite is fine */
    });
  }, [fromInvite, loading, id]);

  const myBid = bids.find((b) => b.tradespersonId === user?.id);

  const bidFillPackages = useMemo(() => {
    const custom = (amcCustomPackages || []).map((p) => ({
      id: `c-${p.id}`,
      label: p.label,
      amountMin: p.amountMin,
      amountMax: p.amountMax,
      unit: p.unit,
      hint: p.hint,
      source: "custom" as const,
    }));
    const soft = softRatePackages(amcHourlyMin, amcHourlyMax).map((p) => ({
      id: `s-${p.id}`,
      label: p.label,
      amountMin: p.amountMin,
      amountMax: p.amountMax,
      unit: "visit" as string | null,
      hint: p.hint,
      source: "soft" as const,
    }));
    return [...custom, ...soft].slice(0, 12);
  }, [amcCustomPackages, amcHourlyMin, amcHourlyMax]);

  function applyPortfolioPackageToBid(pkg: (typeof bidFillPackages)[number]) {
    const amt = String(pkg.amountMin);
    setAmount(amt);
    setQuoteAmount(
      pkg.amountMax != null && Number(pkg.amountMax) > pkg.amountMin
        ? String(pkg.amountMax)
        : amt
    );
    const unit = (pkg.unit && String(pkg.unit).trim()) || "";
    const hint = (pkg.hint && String(pkg.hint).trim()) || "";
    const noteBits = [
      `Package: ${pkg.label}`,
      unit ? `Unit: ${unit}` : "",
      hint,
      pkg.source === "soft" ? "(soft estimate from hourly range)" : "(from portfolio package)",
    ].filter(Boolean);
    setQuoteNotes((prev) => (prev.trim() ? prev : noteBits.join(" · ")));
    setMessage((prev) =>
      prev.trim()
        ? prev
        : `Based on my ${pkg.label} package${unit ? ` (${unit})` : ""}.`
    );
    success(
      `Filled bid/quote from ${pkg.source === "custom" ? "portfolio" : "soft"} package`
    );
  }


  useEffect(() => {
    if (!fromCounter || !myBid?.counterOffer || myBid.counterOffer.status !== "pending") return;
    setQuoteEditAmount(String(myBid.counterOffer.suggestedAmount));
    setQuoteEditNotes(myBid.counterOffer.notes || "");
    setShowQuoteEdit(true);
    // Prefill once per counter-offer (keyed by its request time), not on every bid refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromCounter, myBid?.id, myBid?.counterOffer?.requestedAt, myBid?.counterOffer?.status]);

  async function onBid(e: FormEvent) {
    e.preventDefault();
    try {
      await placeBid(id!, {
        amount: Number(amount),
        message: message || undefined,
        etaDays: etaDays ? Number(etaDays) : undefined,
        proposedVisitStart: visitStart ? new Date(visitStart).toISOString() : undefined,
        proposedVisitEnd: visitEnd ? new Date(visitEnd).toISOString() : undefined,
        quoteAmount: quoteAmount ? Number(quoteAmount) : undefined,
        quoteNotes: quoteNotes || undefined,
        quoteAttachment: quoteFile,
      });
      success("Bid placed");
      try {
        localStorage.setItem("fixlocal:onboarding:pro:bid", "1");
      } catch {
        /* ignore */
      }
      load();
    } catch (err) {
      error((err as Error).message);
    }
  }

  async function onWithdraw() {
    if (!myBid) return;
    try {
      await withdrawBid(myBid.id);
      success("Bid withdrawn");
      load();
    } catch (e) {
      error((e as Error).message);
    }
  }

  async function onStart() {
    try {
      await startJob(id!);
      success("Work started");
      load();
    } catch (e) {
      error((e as Error).message);
    }
  }

  async function onComplete() {
    try {
      await markJobDone(id!);
      success("Marked as done — the client has been asked to confirm and release the remaining payment");
      load();
    } catch (e) {
      error((e as Error).message);
    }
  }

  async function onReviewClient(e: FormEvent) {
    e.preventDefault();
    try {
      await createReview(id!, reviewRating, reviewComment.trim() || undefined);
      success("Thanks — your review of the client was saved");
      load();
    } catch (err) {
      error((err as Error).message);
    }
  }

  async function onDispute(e: FormEvent) {
    e.preventDefault();
    try {
      await createDispute(id!, { reason: disputeReason, files: disputeFiles });
      success("Dispute opened — an admin will review it");
      setDisputeOpen(false);
      setDisputeReason("");
      setDisputeFiles([]);
      load();
    } catch (err) {
      error((err as Error).message);
    }
  }

  async function onDeclineInvite() {
    if (!id) return;
    setShowDeclineSheet(true);
  }

  async function confirmDeclineInvite() {
    if (!id) return;
    setDeclineBusy(true);
    try {
      const r = await declineJobInvite(id, {
        reason: declineReason || undefined,
        note: declineNote.trim() || undefined,
      });
      success(r.message || "Invite declined");
      setInviteBanner(false);
      setShowDeclineSheet(false);
      setDeclineReason("");
      setDeclineNote("");
    } catch (e) {
      error((e as Error).message || "Could not decline invite");
    } finally {
      setDeclineBusy(false);
    }
  }

  if (loadError && !job) {
    return (
      <Shell title="Job">
        <div className="card p-6 text-slate-700" role="alert">
          {loadError}
        </div>
      </Shell>
    );
  }

  if (loading || !job) {
    return (
      <Shell title="Job">
        <Spinner />
      </Shell>
    );
  }

  const isAwardedToMe = myBid?.status === "accepted";
  const liveWork = ["awarded", "in_progress", "pending_confirmation"].includes(job.status);
  const showEscrow =
    isAwardedToMe &&
    (job.acceptedBidId ||
      ["held", "partially_released", "released", "refunded", "simulated_paid"].includes(
        job.paymentStatus || ""
      ));

  return (
    <Shell
      title={job.title}
      subtitle={`${categoryLabel(job.category)} · ${fmtDate(job.createdAt)}`}
      actions={
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() =>
            addFavorite("job", job.id)
              .then(() => success("Saved"))
              .catch((e) => error(e.message))
          }
        >
          <Heart className="h-4 w-4" /> Save
        </button>
      }
    >
      <div className="mb-6 card p-5">
        <StatusTimeline status={job.status} />
        {job.scheduledStart && (
          <p className="mt-3 text-sm text-slate-600">
            Visit {job.scheduleStatus === "confirmed" ? "confirmed" : "proposed"}:{" "}
            <strong>{fmtDateTime(job.scheduledStart)}</strong>
            {job.scheduledEnd ? ` – ${fmtDateTime(job.scheduledEnd)}` : ""}
          </p>
        )}
      </div>
      {inviteBanner && job.status === "open" && !myBid && (
        <div className="mb-4 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-950">
          <p className="font-medium">You were invited to bid on this job</p>
          <p className="mt-1 text-xs text-brand-800/80">
            Jump to the bid form below, or softly decline if you are not available.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => bidFormRef.current?.scrollIntoView({ behavior: "smooth" })}
            >
              Place a bid
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={declineBusy}
              onClick={onDeclineInvite}
            >
              Decline invite
            </button>
          </div>
          {showDeclineSheet && (
            <div className="mt-3 rounded-xl bg-white/80 p-3 ring-1 ring-brand-100 space-y-3">
              <p className="text-xs font-medium text-brand-950">Why are you declining? (optional)</p>
              <div className="flex flex-wrap gap-2">
                {DECLINE_CHIPS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={
                      declineReason === c.id
                        ? "rounded-full bg-brand-700 px-3 py-1 text-xs font-medium text-white"
                        : "rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200"
                    }
                    onClick={() => setDeclineReason((prev) => (prev === c.id ? "" : c.id))}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <textarea
                className="input min-h-[64px] text-sm"
                maxLength={300}
                placeholder="Optional note for the client"
                value={declineNote}
                onChange={(e) => setDeclineNote(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-danger btn-sm"
                  disabled={declineBusy}
                  onClick={confirmDeclineInvite}
                >
                  {declineBusy ? "…" : "Confirm decline"}
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={declineBusy}
                  onClick={() => {
                    setShowDeclineSheet(false);
                    setDeclineReason("");
                    setDeclineNote("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <section className="card p-6 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge status={job.status} />
              {job.paymentStatus && isAwardedToMe && <Badge status={job.paymentStatus} />}
              {job.cadence && normalizeCadence(job.cadence) !== "one_time" && (
                <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-800 ring-1 ring-violet-100">
                  {cadenceLabel(job.cadence)}
                </span>
              )}
            </div>
            <p className="text-slate-700 whitespace-pre-wrap">{job.description}</p>
            <p className="text-sm text-slate-500">
              {job.exactLocation
                ? [job.address, job.area, job.pincode].filter(Boolean).join(", ") || "Location TBD"
                : `${[job.area, job.city].filter(Boolean).join(", ") || "Location TBD"} (exact address shared once you're hired)`}{" "}
              · Budget {money(job.budgetMin)} – {money(job.budgetMax)}
            </p>
            {job.photoUrls?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {job.photoUrls.map((u) => (
                  <img
                    key={u}
                    src={mediaUrl(u)}
                    alt=""
                    className="h-24 w-24 rounded-xl object-cover ring-1 ring-slate-200"
                  />
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {isAwardedToMe && job.status === "awarded" && (
                <button type="button" className="btn-primary" onClick={onStart}>
                  Start work
                </button>
              )}
              {isAwardedToMe && job.status === "in_progress" && (
                <button type="button" className="btn-primary" onClick={onComplete}>
                  Mark work done
                </button>
              )}
              {isAwardedToMe && (liveWork || job.status === "completed") && (
                <button type="button" className="btn-secondary" onClick={() => setDisputeOpen((v) => !v)}>
                  Open dispute
                </button>
              )}
            </div>
            {isAwardedToMe && job.status === "pending_confirmation" && (
              <p className="rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900 ring-1 ring-sky-100" role="status">
                Waiting for the client to confirm. If they don't respond, the job is confirmed automatically and the
                remaining payment is released.
              </p>
            )}
            {disputeOpen && (
              <form onSubmit={onDispute} className="space-y-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
                <label className="label" htmlFor="pro-dispute-reason">
                  What went wrong?
                </label>
                <textarea
                  id="pro-dispute-reason"
                  className="input"
                  required
                  maxLength={4000}
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                />
                <label className="label" htmlFor="pro-dispute-files">
                  Evidence (photos or PDF, up to 5)
                </label>
                <input
                  id="pro-dispute-files"
                  className="input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  multiple
                  onChange={(e) => setDisputeFiles(Array.from(e.target.files || []).slice(0, 5))}
                />
                <button type="submit" className="btn-primary btn-sm">
                  Submit dispute
                </button>
              </form>
            )}
          </section>

          {isAwardedToMe && liveWork && (
            <SchedulePanel
              job={job}
              userId={user?.id}
              canManage
              onChanged={load}
              proAvailability={proAvailability}
            />
          )}

          {isAwardedToMe && (job.status === "awarded" || job.status === "in_progress") && (
            <ProVisitDayCard job={job} />
          )}

          {isAwardedToMe && (liveWork || job.status === "completed") && (
            <AmcProposalCard
              job={job}
              role="pro"
              onChanged={load}
              customRatePackages={amcCustomPackages}
              hourlyRateMin={amcHourlyMin}
              hourlyRateMax={amcHourlyMax}
            />
          )}

          {showEscrow && <PaymentPanel job={job} canRelease={false} onChanged={load} />}

          {isAwardedToMe && (liveWork || job.status === "completed" || job.status === "disputed") && (
            <CompletionPhotosPanel job={job} canEdit canPublishCaseStudy onChanged={load} />
          )}

          {isAwardedToMe && job.status === "completed" && (
            <section className="card p-6">
              <h2 className="mb-3 text-lg font-semibold">Review the client</h2>
              {clientReview ? (
                <div>
                  <StarRating value={clientReview.rating} readonly />
                  {clientReview.comment && <p className="mt-2 text-sm text-slate-600">{clientReview.comment}</p>}
                </div>
              ) : (
                <form onSubmit={onReviewClient} className="space-y-3">
                  <StarRating value={reviewRating} onChange={setReviewRating} />
                  <textarea
                    className="input"
                    aria-label="Review comment"
                    maxLength={2000}
                    placeholder="Was the brief clear? Did they pay on time?"
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                  />
                  <button type="submit" className="btn-primary">
                    Submit review
                  </button>
                </form>
              )}
            </section>
          )}

          {job.status === "open" && !myBid && (
            <form
              id="bid-form"
              ref={bidFormRef}
              onSubmit={onBid}
              className="card p-6 space-y-3 scroll-mt-24"
            >
              <h2 className="font-semibold text-lg">Place a bid</h2>
              <p className="text-xs text-slate-500">You must be admin-verified to bid.</p>
              {bidFillPackages.length > 0 && (
                <div className="rounded-xl bg-violet-50/70 p-3 ring-1 ring-violet-100 space-y-2">
                  <p className="text-xs font-semibold text-violet-950">
                    Fill from portfolio packages
                  </p>
                  <p className="text-[11px] text-violet-900/80">
                    One-click fills bid amount + structured quote from your custom or soft rate cards.
                  </p>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Portfolio packages for bid">
                    {bidFillPackages.map((pkg) => (
                      <button
                        key={pkg.id}
                        type="button"
                        className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-violet-50 hover:ring-violet-200"
                        title={pkg.hint || formatCustomPackage(pkg as CustomRatePackage)}
                        onClick={() => applyPortfolioPackageToBid(pkg)}
                      >
                        {pkg.label}
                        <span className="ml-1 text-slate-400">
                          · {money(pkg.amountMin)}
                          {pkg.source === "soft" ? " ≈" : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="bid-amount">Amount (₹)</label>
                  <input
                    id="bid-amount"
                    className="input"
                    type="number"
                    min={1}
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="bid-eta">ETA days</label>
                  <input
                    id="bid-eta"
                    className="input"
                    type="number"
                    min={1}
                    value={etaDays}
                    onChange={(e) => setEtaDays(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="bid-visit-start">Proposed visit start (optional)</label>
                  <input
                    id="bid-visit-start"
                    className="input"
                    type="datetime-local"
                    value={visitStart}
                    onChange={(e) => setVisitStart(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="bid-visit-end">Proposed visit end</label>
                  <input
                    id="bid-visit-end"
                    className="input"
                    type="datetime-local"
                    value={visitEnd}
                    onChange={(e) => setVisitEnd(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="bid-message">Message</label>
                <textarea
                  id="bid-message"
                  className="input"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What's included?"
                />
              </div>
              <div className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-100 space-y-2">
                <p className="text-xs font-semibold text-amber-900">Optional structured quote / estimate</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="bid-quote-amount">Quote amount (₹)</label>
                    <input
                      id="bid-quote-amount"
                      className="input"
                      type="number"
                      min={1}
                      value={quoteAmount}
                      onChange={(e) => setQuoteAmount(e.target.value)}
                      placeholder="Defaults to bid amount if blank"
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="bid-quote-file">Quote PDF / image</label>
                    <input
                      id="bid-quote-file"
                      className="input"
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      onChange={(e) => setQuoteFile(e.target.files?.[0] || null)}
                    />
                  </div>
                </div>
                <textarea
                  className="input"
                  rows={2}
                  aria-label="Quote notes"
                  value={quoteNotes}
                  onChange={(e) => setQuoteNotes(e.target.value)}
                  placeholder="Materials, labour breakdown, warranty…"
                />
              </div>
              <button type="submit" className="btn-primary">
                Submit bid
              </button>
            </form>
          )}

          {myBid && myBid.counterOffer && myBid.counterOffer.status === "pending" && (
            <div className="mb-4 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950">
              <p className="font-medium">Client requested a quote revise</p>
              <p className="mt-1 text-xs text-violet-900/80">
                Suggested amount:{" "}
                <strong>
                  ₹{Number(myBid.counterOffer.suggestedAmount).toFixed(0)}
                </strong>
                {myBid.counterOffer.notes
                  ? ` — “${myBid.counterOffer.notes}”`
                  : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => {
                    setQuoteEditAmount(String(myBid.counterOffer!.suggestedAmount));
                    setQuoteEditNotes(myBid.counterOffer?.notes || "");
                    setShowQuoteEdit(true);
                    document.getElementById("bid-form")?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  Revise toward suggestion
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => {
                    setShowCounterDecline(true);
                    setCounterDeclineTplId(null);
                    setCounterDeclineNote("");
                    setCounterDeclineFloor("");
                  }}
                >
                  Decline counter
                </button>
              </div>
              {showCounterDecline && (
                <div className="mt-3 rounded-xl bg-white/90 p-3 ring-1 ring-violet-200">
                  <p className="text-xs font-semibold text-violet-950">Decline with a template</p>
                  <p className="mt-0.5 text-[11px] text-violet-900/70">
                    Pick a chip (no browser prompt). Optional floor replaces ₹X.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {mergeCounterTemplates(user?.counterTemplates).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={
                          counterDeclineTplId === t.id
                            ? "rounded-full bg-violet-700 px-2.5 py-1 text-[11px] font-semibold text-white"
                            : "rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-medium text-violet-900 ring-1 ring-violet-200"
                        }
                        onClick={() => {
                          setCounterDeclineTplId(t.id);
                          setCounterDeclineNote(t.body);
                        }}
                      >
                        {t.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={
                        counterDeclineTplId === "__custom"
                          ? "rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-white"
                          : "rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200"
                      }
                      onClick={() => {
                        setCounterDeclineTplId("__custom");
                        setCounterDeclineNote("");
                      }}
                    >
                      Freeform
                    </button>
                  </div>
                  {counterDeclineNote.includes("₹X") || counterDeclineNote.includes(" X ") ? (
                    <label className="mt-2 block text-[11px] text-slate-600">
                      Floor amount for ₹X
                      <input
                        className="input mt-1 h-8 text-sm"
                        type="text"
                        inputMode="numeric"
                        placeholder="e.g. 2800"
                        value={counterDeclineFloor}
                        onChange={(e) => setCounterDeclineFloor(e.target.value)}
                      />
                    </label>
                  ) : null}
                  <textarea
                    className="input mt-2 text-sm"
                    rows={3}
                    placeholder="Decline note (optional)"
                    value={counterDeclineNote}
                    onChange={(e) => {
                      setCounterDeclineTplId((cur) =>
                        cur && cur !== "__custom" ? cur : "__custom"
                      );
                      setCounterDeclineNote(e.target.value);
                    }}
                  />
                  {counterDeclineFloor.trim() && /₹X|\bX\b/i.test(counterDeclineNote) ? (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Preview:{" "}
                      {counterDeclineNote
                        .replace(/₹X/gi, `₹${counterDeclineFloor.trim()}`)
                        .replace(/\bX\b/g, counterDeclineFloor.trim())}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      disabled={counterDeclineBusy}
                      onClick={async () => {
                        let notes = counterDeclineNote;
                        if (counterDeclineFloor.trim()) {
                          notes = notes
                            .replace(/₹X/gi, `₹${counterDeclineFloor.trim()}`)
                            .replace(/\bX\b/g, counterDeclineFloor.trim());
                        }
                        setCounterDeclineBusy(true);
                        try {
                          await declineCounterOffer(myBid.id, {
                            notes: notes.trim() || undefined,
                          });
                          success("Counter-offer declined");
                          setShowCounterDecline(false);
                          load();
                        } catch (e) {
                          error((e as Error).message || "Could not decline counter");
                        } finally {
                          setCounterDeclineBusy(false);
                        }
                      }}
                    >
                      {counterDeclineBusy ? "…" : "Confirm decline"}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={counterDeclineBusy}
                      onClick={() => setShowCounterDecline(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {myBid?.viewedNoReply?.due && (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p className="font-medium">Viewed but no reply</p>
              <p className="mt-1 text-xs text-amber-900/80">
                Homeowner viewed your revised quote
                {myBid.viewedNoReply.hoursSinceView != null
                  ? ` ~${Math.floor(myBid.viewedNoReply.hoursSinceView)}h ago`
                  : ""}
                {" "}with no further revise (SLA soft flag). Consider updating the quote or messaging.
              </p>
            </div>
          )}

          {myBid && Array.isArray(myBid.counterHistory) && myBid.counterHistory.length > 0 && (
            <details className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium text-slate-800">
                Counter-offer history ({myBid.counterHistory.length})
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {[...myBid.counterHistory].reverse().map((h, i) => (
                  <li key={`${h.requestedAt}-${i}`}>
                    ₹{Number(h.suggestedAmount).toFixed(0)} · {h.status}
                    <span className="text-slate-400">
                      {" "}
                      · {new Date(h.requestedAt).toLocaleString()}
                    </span>
                    {h.declinedNotes ? ` — “${h.declinedNotes}”` : h.notes ? ` — “${h.notes}”` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {myBid && (
            <div className="card p-6">
              <h2 className="font-semibold">Your bid</h2>
              <p className="mt-2 text-2xl font-bold">{money(myBid.amount)}</p>
              <div className="mt-2">
                <Badge status={myBid.status} />
              </div>
              {myBid.message && <p className="mt-2 text-sm text-slate-600">{myBid.message}</p>}
              {(myBid.quoteAmount != null || myBid.quoteNotes || (myBid.quoteHistory && myBid.quoteHistory.length > 0)) && (
                <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm ring-1 ring-amber-100">
                  <p className="font-semibold text-amber-950">
                    Quote {myBid.quoteAmount != null ? money(myBid.quoteAmount) : ""}
                    {myBid.quoteHistory && myBid.quoteHistory.length > 0
                      ? ` · ${myBid.quoteHistory.length} prior revision(s)`
                      : ""}
                  </p>
                  {myBid.quoteNotes && <p className="mt-1 text-slate-700 whitespace-pre-wrap">{myBid.quoteNotes}</p>}
                  {myBid.quoteAttachmentUrl && (
                    <a
                      className="mt-1 inline-block text-xs text-brand-700 underline"
                      href={mediaUrl(myBid.quoteAttachmentUrl)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View quote attachment
                    </a>
                  )}
                  {myBid.quoteHistory && myBid.quoteHistory.length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-amber-200/70 pt-2 text-[11px] text-slate-600">
                      {(() => {
                        const hist = myBid.quoteHistory || [];
                        const last = hist[hist.length - 1];
                        const delta =
                          last?.amount != null && myBid.quoteAmount != null
                            ? Number(myBid.quoteAmount) - Number(last.amount)
                            : null;
                        return (
                          <>
                            {delta != null && delta !== 0 && (
                              <li
                                className={
                                  delta < 0
                                    ? "font-semibold text-emerald-700"
                                    : "font-semibold text-rose-700"
                                }
                              >
                                Latest Δ {delta > 0 ? "+" : ""}
                                {money(delta)}
                              </li>
                            )}
                            {[...hist].reverse().slice(0, 5).map((h, i) => (
                              <li key={`${h.revisedAt}-${i}`}>
                                Was {h.amount != null ? money(h.amount) : "—"} ·{" "}
                                {new Date(h.revisedAt).toLocaleString()}
                                {h.notes ? (
                                  <span className="block truncate text-slate-400">“{h.notes}”</span>
                                ) : null}
                              </li>
                            ))}
                          </>
                        );
                      })()}
                    </ul>
                  )}
                </div>
              )}
              {myBid.status === "active" && job.status === "open" && (
                <div className="mt-3">
                  {!showQuoteEdit ? (
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => {
                        setQuoteEditAmount(
                          myBid.quoteAmount != null ? String(myBid.quoteAmount) : ""
                        );
                        setQuoteEditNotes(myBid.quoteNotes || "");
                        setShowQuoteEdit(true);
                      }}
                    >
                      Revise quote
                    </button>
                  ) : (
                    <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-3 space-y-2">
                      <p className="text-xs font-semibold text-amber-950">Revise structured quote</p>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        placeholder="Quote amount"
                        value={quoteEditAmount}
                        onChange={(e) => setQuoteEditAmount(e.target.value)}
                      />
                      <textarea
                        className="input min-h-[60px]"
                        placeholder="Quote notes"
                        value={quoteEditNotes}
                        onChange={(e) => setQuoteEditNotes(e.target.value)}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          disabled={quoteEditBusy}
                          onClick={async () => {
                            setQuoteEditBusy(true);
                            try {
                              await updateBidQuote(myBid.id, {
                                quoteAmount: quoteEditAmount
                                  ? Number(quoteEditAmount)
                                  : undefined,
                                quoteNotes: quoteEditNotes,
                              });
                              success("Quote revised");
                              setShowQuoteEdit(false);
                              await load();
                            } catch (e) {
                              error((e as Error).message || "Quote revise failed");
                            } finally {
                              setQuoteEditBusy(false);
                            }
                          }}
                        >
                          {quoteEditBusy ? "Saving…" : "Save revision"}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => setShowQuoteEdit(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {myBid.proposedVisitStart && (
                <p className="mt-2 text-sm text-brand-700">
                  Proposed visit: {fmtDateTime(myBid.proposedVisitStart)}
                  {myBid.proposedVisitEnd ? ` – ${fmtDateTime(myBid.proposedVisitEnd)}` : ""}
                </p>
              )}
              {myBid.status === "active" && job.status === "open" && (
                <button type="button" className="btn-danger btn-sm mt-3" onClick={onWithdraw}>
                  Withdraw
                </button>
              )}
            </div>
          )}

          {(isAwardedToMe || (myBid?.status === "active" && job.status === "open")) && (
            <JobChat jobId={job.id} title="Messages with the client" />
          )}
        </div>
        <aside className="h-fit space-y-3">
          <div className="card p-5">
            <h3 className="font-semibold">Competition</h3>
            <p className="mt-2 text-sm text-slate-600">
              {job.status !== "open"
                ? "Bidding has closed."
                : otherBidCount === 0
                  ? "No other active bids yet."
                  : `${otherBidCount} other active bid${otherBidCount === 1 ? "" : "s"} (amounts are private).`}
            </p>
            <p className="mt-1 text-xs text-slate-400">Up to {job.maxBids} bids are accepted on this job.</p>
          </div>
          <ReportButton targetType="job" targetId={job.id} label="Report this job" />
        </aside>
      </div>
    </Shell>
  );
}
