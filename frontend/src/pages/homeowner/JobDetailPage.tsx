import { CategoryIcon } from "../../components/CategoryIcon";
import { Link } from "react-router-dom";
import { Shell } from "../../components/Shell";
import { mediaUrl } from "../../api/jobs";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { StatusTimeline } from "../../components/ui/StatusTimeline";
import { ReviewPanel } from "./job/ReviewPanel";
import { DisputeForm } from "./job/DisputeForm";
import { JobConversations } from "../../components/JobConversations";
import { ReportButton } from "../../components/ReportButton";
import { BlockButton } from "../../components/BlockButton";
import {
  CancelBookingButton,
  CancellationNote,
} from "../../components/CancelBookingButton";
import { PaymentPanel } from "../../components/PaymentPanel";
import { CompletionPhotosPanel } from "../../components/CompletionPhotosPanel";
import { SchedulePanel } from "../../components/SchedulePanel";
import { VisitPrepCard } from "../../components/VisitPrepCard";
import { clientPath } from "../../lib/paths";
import { cadenceLabel, normalizeCadence } from "../../lib/jobCadence";
import { saveRepeatDraft } from "../../lib/repeatJob";
import {
  mergeNamedJobTemplates,
  namedTemplateFromJob,
  upsertNamedJobTemplate,
} from "../../lib/namedJobTemplates";
import {
  categoryLabel,
  fmtDate,
  fmtDateTime,
  money,
} from "../../lib/format";
import { Heart, MapPin } from "lucide-react";
import { Suspense, lazy } from "react";

// Below-the-fold and on-demand panels load in their own chunks.
const AmcProposalCard = lazy(() =>
  import("../../components/AmcProposalCard").then((m) => ({
    default: m.AmcProposalCard,
  })),
);
const MatchScorePanel = lazy(() =>
  import("../../components/MatchScorePanel").then((m) => ({
    default: m.MatchScorePanel,
  })),
);
const BestValueExplainPanel = lazy(() =>
  import("../../components/BestValueExplainPanel").then((m) => ({
    default: m.BestValueExplainPanel,
  })),
);
import { useJobDetail } from "./job/useJobDetail";
import { UrgentBadge } from "../../components/UrgentBadge";
import { JobExpiryNotice } from "../../components/JobExpiryNotice";
import { JobQuestionsPanel } from "../../components/JobQuestionsPanel";
import { ShortlistInvitePanel } from "./job/ShortlistInvitePanel";
import { SuggestedProsPanel } from "./job/SuggestedProsPanel";
import { BidComparePanel } from "./job/BidComparePanel";
import { t } from "../../lib/i18n";

export function JobDetailPage() {
  const s = useJobDetail();
  const {
    bestValueExplain,
    bids,
    error,
    job,
    load,
    loading,
    loadError,
    reload,
    navigate,
    onCancel,
    onComplete,
    onPhotoConsent,
    proAvailability,
    proBlockedDates,
    proReview,
    review,
    saved,
    scorePro,
    searchParams,
    setBestValueExplain,
    setScorePro,
    setShowDispute,
    showDispute,
    success,
    toggleSave,
    updateProfile,
    user,
  } = s;

  if (loadError && !job) {
    return (
      <Shell title={t("Job")}>
        <div className="card p-6 text-slate-700" role="alert">
          <p className="font-medium">{t("We couldn't open this job.")}</p>
          <p className="mt-1 text-sm text-slate-600">{loadError}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => reload()}
            >
              {t("Try again")}
            </button>
            <Link to={clientPath()} className="btn-ghost">
              {t("Back to dashboard")}
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (loading || !job) {
    return (
      <Shell title={t("Job")}>
        <Spinner />
      </Shell>
    );
  }

  const reviewPanel = (
    <ReviewPanel
      jobId={job.id}
      review={review}
      proReview={proReview}
      onSaved={load}
      proName={bids.find((b) => b.id === job.acceptedBidId)?.tradesperson?.name}
    />
  );

  const sortedBids = [...bids].sort(
    (a, b) => Number(a.amount || 0) - Number(b.amount || 0),
  );
  const liveWork = ["awarded", "in_progress", "pending_confirmation"].includes(
    job.status,
  );
  const hired =
    liveWork || job.status === "completed" || job.status === "disputed";
  const canMessage =
    job.status === "open" ||
    hired ||
    (job.status === "cancelled" && !!job.acceptedBidId);
  const showEscrow =
    !!job.acceptedBidId ||
    [
      "held",
      "partially_released",
      "released",
      "refunded",
      "simulated_paid",
    ].includes(job.paymentStatus || "");

  return (
    <Shell
      title={job.title}
      subtitle={
        <>
          <CategoryIcon category={job.category} className="mr-1.5" />
          {`${categoryLabel(job.category)}${
            job.cadence && normalizeCadence(job.cadence) !== "one_time"
              ? ` · ${cadenceLabel(job.cadence)}`
              : ""
          } · Posted ${fmtDate(job.createdAt)}`}
        </>
      }
      actions={
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={toggleSave}
          aria-label={t("Save job")}
        >
          <Heart
            className={`h-4 w-4 ${saved ? "fill-rose-500 text-rose-500" : ""}`}
          />
          {saved ? t("Saved") : t("Save")}
        </button>
      }
    >
      <div className="mb-6 card p-5">
        <StatusTimeline status={job.status} />
        {job.scheduledStart && (
          <p className="mt-3 text-sm text-slate-600">
            {t("Visit")}{" "}
            {job.scheduleStatus === "confirmed" ? "confirmed" : "proposed"}:{" "}
            <strong>{fmtDateTime(job.scheduledStart)}</strong>
            {job.scheduledEnd ? ` – ${fmtDateTime(job.scheduledEnd)}` : ""}
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {job.status === "completed" && !review && reviewPanel}
          <section className="card p-6 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge status={job.status} />
              {job.urgent && <UrgentBadge />}
              {job.paymentStatus && <Badge status={job.paymentStatus} />}
              {job.scheduleStatus && job.scheduleStatus !== "none" && (
                <Badge status={job.scheduleStatus} />
              )}
            </div>
            <JobExpiryNotice job={job} onUpdated={(j) => s.setJob(j)} />
            <p className="text-slate-700 whitespace-pre-wrap">
              {job.description}
            </p>
            <div className="flex flex-wrap gap-4 text-sm text-slate-500">
              {(job.area || job.address) && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {[job.address, job.area, job.pincode]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              )}
              <span>
                {t("Budget")}{" "}{money(job.budgetMin)} – {money(job.budgetMax)}
              </span>
              <span>{t("Max bids")}{" "}{job.maxBids}</span>
            </div>
            {job.photoUrls?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {job.photoUrls.map((u) => (
                  <a
                    key={u}
                    href={mediaUrl(u)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      src={mediaUrl(u)}
                      alt=""
                      className="h-24 w-24 rounded-xl object-cover ring-1 ring-slate-200"
                    />
                  </a>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              {job.status === "awarded" && (
                <p
                  className="w-full text-sm text-slate-600"
                  data-testid="awaiting-start"
                >
                  {t("You can confirm completion once the professional starts work.")}
                </p>
              )}
              {job.status === "awarded" && (
                <CancelBookingButton
                  jobId={job.id}
                  side="client"
                  onDone={() => load()}
                />
              )}
              {job.status === "cancelled" && (
                <CancellationNote
                  cancelledBy={job.cancelledBy}
                  reason={job.cancellationReason}
                />
              )}
              {(job.status === "in_progress" ||
                job.status === "pending_confirmation") && (
                <button
                  type="button"
                  className={
                    job.status === "pending_confirmation"
                      ? "btn-primary"
                      : "btn-secondary"
                  }
                  onClick={onComplete}
                >
                  {job.status === "pending_confirmation"
                    ? t("Confirm work is complete")
                    : t("Mark completed")}
                </button>
              )}
              {job.status === "completed" && (
                <>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      saveRepeatDraft(job);
                      success("Prefilling post-job wizard from this job");
                      navigate(clientPath("jobs/new"));
                    }}
                  >
                    {t("Repeat this job")}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={async () => {
                      const suggested =
                        (job.title || "Job")
                          .replace(/\s*\(repeat\)\s*$/i, "")
                          .trim() || "My job template";
                      const name =
                        window
                          .prompt("Name this job template", suggested)
                          ?.trim() || suggested;
                      const entry = namedTemplateFromJob(job, name);
                      try {
                        await updateProfile({
                          namedJobTemplates: upsertNamedJobTemplate(
                            mergeNamedJobTemplates(user?.namedJobTemplates),
                            entry,
                          ),
                        });
                        success(`Saved “${entry.name}” to your job templates`);
                      } catch (e) {
                        error(
                          (e as Error).message || "Couldn't save the template",
                        );
                      }
                    }}
                  >
                    {t("Save as template")}
                  </button>
                </>
              )}
              {job.status === "open" && (
                <button
                  type="button"
                  className="btn-ghost text-red-700 hover:bg-red-50"
                  onClick={onCancel}
                >
                  {t("Cancel job")}
                </button>
              )}
              {(liveWork || job.status === "completed") && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowDispute(true)}
                >
                  {t("Open dispute")}
                </button>
              )}
            </div>
            {job.status === "pending_confirmation" && (
              <p
                className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200"
                role="status"
              >
                {t("The professional marked this job as done. Confirm to release the remaining payment, or open a dispute if something isn't right.")}
                {job.autoConfirmAt
                  ? `If you don't respond, it will be confirmed automatically on ${fmtDateTime(job.autoConfirmAt)}.`
                  : t("It will be confirmed automatically in a few days if you don't respond.")}
              </p>
            )}
            {showDispute && (
              <DisputeForm
                jobId={job.id}
                onCancel={() => setShowDispute(false)}
                onOpened={() => {
                  setShowDispute(false);
                  load();
                }}
              />
            )}
          </section>

          <JobQuestionsPanel jobId={job.id} />

          {liveWork && (
            <SchedulePanel
              job={job}
              userId={user?.id}
              canManage
              onChanged={load}
              proAvailability={proAvailability}
              blockedDates={proBlockedDates}
            />
          )}

          {(job.status === "awarded" || job.status === "in_progress") && (
            <VisitPrepCard job={job} />
          )}
          {job.cadence && normalizeCadence(job.cadence) !== "one_time" && (
            <p className="rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-900 ring-1 ring-violet-100">
              <span className="font-semibold">{t("Cadence preference:")}</span>{" "}
              {cadenceLabel(job.cadence)}
              {job.cadenceNote ? ` — ${job.cadenceNote}` : ""}{t(". Soft only — negotiate schedule in chat.")}
            </p>
          )}

          {(liveWork || job.status === "completed") && (
            <Suspense fallback={null}>
              <AmcProposalCard job={job} role="client" onChanged={load} />
            </Suspense>
          )}

          {showEscrow && (
            <PaymentPanel
              job={job}
              canRelease={liveWork || job.status === "completed"}
              onChanged={load}
            />
          )}

          {hired && (
            <CompletionPhotosPanel job={job} canEdit={hired} onChanged={load} />
          )}

          {job.status === "completed" &&
          (job.beforePhotoUrls?.length || job.afterPhotoUrls?.length) ? (
            <section className="card p-5">
              <label
                className="flex items-start gap-3 text-sm"
                htmlFor="photo-consent"
              >
                <input
                  id="photo-consent"
                  type="checkbox"
                  className="mt-1"
                  checked={!!job.photoConsent}
                  onChange={(e) => onPhotoConsent(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-slate-900">
                    {t("Allow the professional to show these photos in their portfolio")}
                  </span>
                  <span className="block text-slate-500">
                    {t("Only the completion photos are shared, never your address. You can turn this off at any time.")}
                  </span>
                </span>
              </label>
            </section>
          ) : null}

          {/* Once bids arrive they are the decision in front of the client, so they come first. */}
          {bids.length > 0 && (
            <BidComparePanel s={s} job={job} sortedBids={sortedBids} />
          )}

          <ShortlistInvitePanel s={s} job={job} />

          <SuggestedProsPanel s={s} job={job} />

          {bids.length === 0 && (
            <BidComparePanel s={s} job={job} sortedBids={sortedBids} />
          )}

          {job.status === "completed" && review && reviewPanel}

          {canMessage && (
            <JobConversations
              jobId={job.id}
              initialProId={searchParams.get("chat") || undefined}
              hiredProId={
                bids.find((b) => b.id === job.acceptedBidId)?.tradespersonId
              }
            />
          )}
        </div>

        <aside className="space-y-4">
          <div className="card p-5">
            <h3 className="font-semibold text-slate-900">{t("Job summary")}</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">{t("Status")}</dt>
                <dd>
                  <Badge status={job.status} />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">{t("Payment")}</dt>
                <dd>
                  <Badge status={job.paymentStatus || "pending"} />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">{t("Category")}</dt>
                <dd className="font-medium">{categoryLabel(job.category)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">{t("Bids")}</dt>
                <dd className="font-medium">
                  {
                    bids.filter(
                      (b) => b.status === "active" || b.status === "accepted",
                    ).length
                  }
                </dd>
              </div>
              {job.completedAt && (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">{t("Completed")}</dt>
                  <dd className="font-medium">{fmtDate(job.completedAt)}</dd>
                </div>
              )}
            </dl>
          </div>
          {job.acceptedBidId && (
            <ReportButton
              targetType="user"
              targetId={
                bids.find((b) => b.id === job.acceptedBidId)?.tradespersonId
              }
              label={t("Report this professional")}
            />
          )}
          {job.acceptedBidId && (
            <BlockButton
              userId={
                bids.find((b) => b.id === job.acceptedBidId)?.tradespersonId
              }
              name={
                bids.find((b) => b.id === job.acceptedBidId)?.tradesperson?.name
              }
            />
          )}
        </aside>
      </div>

      <Suspense fallback={null}>
        {scorePro && (
          <MatchScorePanel
            open={!!scorePro}
            onClose={() => setScorePro(null)}
            name={scorePro.name}
            score={scorePro.score}
            breakdown={scorePro.breakdown}
          />
        )}
        {bestValueExplain && (
          <BestValueExplainPanel
            open={!!bestValueExplain}
            onClose={() => setBestValueExplain(null)}
            row={bestValueExplain}
          />
        )}
      </Suspense>
    </Shell>
  );
}
