import { Shell } from "../../components/Shell";
import { mediaUrl } from "../../api/jobs";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { StatusTimeline } from "../../components/ui/StatusTimeline";
import { ReviewPanel } from "./job/ReviewPanel";
import { DisputeForm } from "./job/DisputeForm";
import { JobConversations } from "../../components/JobConversations";
import { ReportButton } from "../../components/ReportButton";
import { PaymentPanel } from "../../components/PaymentPanel";
import { CompletionPhotosPanel } from "../../components/CompletionPhotosPanel";
import { SchedulePanel } from "../../components/SchedulePanel";
import { VisitPrepCard } from "../../components/VisitPrepCard";
import { AmcProposalCard } from "../../components/AmcProposalCard";
import { clientPath } from "../../lib/paths";
import { cadenceLabel, normalizeCadence } from "../../lib/jobCadence";
import { saveRepeatDraft } from "../../lib/repeatJob";
import {
  mergeNamedJobTemplates,
  namedTemplateFromJob,
  upsertNamedJobTemplate,
} from "../../lib/namedJobTemplates";
import {
  categoryEmoji,
  categoryLabel,
  fmtDate,
  fmtDateTime,
  money,
} from "../../lib/format";
import { Heart, MapPin } from "lucide-react";
import { MatchScorePanel } from "../../components/MatchScorePanel";
import { BestValueExplainPanel } from "../../components/BestValueExplainPanel";
import { useJobDetail } from "./job/useJobDetail";
import { ShortlistInvitePanel } from "./job/ShortlistInvitePanel";
import { SuggestedProsPanel } from "./job/SuggestedProsPanel";
import { BidComparePanel } from "./job/BidComparePanel";

export function JobDetailPage() {
  const s = useJobDetail();
  const {
    bestValueExplain,
    bids,
    error,
    job,
    load,
    loading,
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

  if (loading || !job) {
    return (
      <Shell title="Job">
        <Spinner />
      </Shell>
    );
  }

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
      subtitle={`${categoryEmoji(job.category)} ${categoryLabel(job.category)}${
        job.cadence && normalizeCadence(job.cadence) !== "one_time"
          ? ` · ${cadenceLabel(job.cadence)}`
          : ""
      } · Posted ${fmtDate(job.createdAt)}`}
      actions={
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={toggleSave}
          aria-label="Save job"
        >
          <Heart
            className={`h-4 w-4 ${saved ? "fill-rose-500 text-rose-500" : ""}`}
          />
          {saved ? "Saved" : "Save"}
        </button>
      }
    >
      <div className="mb-6 card p-5">
        <StatusTimeline status={job.status} />
        {job.scheduledStart && (
          <p className="mt-3 text-sm text-slate-600">
            Visit{" "}
            {job.scheduleStatus === "confirmed" ? "confirmed" : "proposed"}:{" "}
            <strong>{fmtDateTime(job.scheduledStart)}</strong>
            {job.scheduledEnd ? ` – ${fmtDateTime(job.scheduledEnd)}` : ""}
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <section className="card p-6 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge status={job.status} />
              {job.paymentStatus && <Badge status={job.paymentStatus} />}
              {job.scheduleStatus && job.scheduleStatus !== "none" && (
                <Badge status={job.scheduleStatus} />
              )}
            </div>
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
                Budget {money(job.budgetMin)} – {money(job.budgetMax)}
              </span>
              <span>Max bids {job.maxBids}</span>
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
              {liveWork && (
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
                    ? "Confirm work is complete"
                    : "Mark completed"}
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
                    Repeat this job
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
                    Save as template
                  </button>
                </>
              )}
              {job.status === "open" && (
                <button type="button" className="btn-danger" onClick={onCancel}>
                  Cancel job
                </button>
              )}
              {(liveWork || job.status === "completed") && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowDispute(true)}
                >
                  Open dispute
                </button>
              )}
            </div>
            {job.status === "pending_confirmation" && (
              <p
                className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200"
                role="status"
              >
                The professional marked this job as done. Confirm to release the
                remaining payment, or open a dispute if something isn't right.
                It will be confirmed automatically in a few days if you don't
                respond.
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
              <span className="font-semibold">Cadence preference:</span>{" "}
              {cadenceLabel(job.cadence)}
              {job.cadenceNote ? ` — ${job.cadenceNote}` : ""}. Soft only —
              negotiate schedule in chat.
            </p>
          )}

          {(liveWork || job.status === "completed") && (
            <AmcProposalCard job={job} role="client" onChanged={load} />
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
                    Allow the professional to show these photos in their
                    portfolio
                  </span>
                  <span className="block text-slate-500">
                    Only the completion photos are shared, never your address.
                    You can turn this off at any time.
                  </span>
                </span>
              </label>
            </section>
          ) : null}

          <ShortlistInvitePanel s={s} job={job} />

          <SuggestedProsPanel s={s} job={job} />

          <BidComparePanel s={s} job={job} sortedBids={sortedBids} />

          {job.status === "completed" && (
            <ReviewPanel
              jobId={job.id}
              review={review}
              proReview={proReview}
              onSaved={load}
            />
          )}

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
            <h3 className="font-semibold text-slate-900">Job summary</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Status</dt>
                <dd>
                  <Badge status={job.status} />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Payment</dt>
                <dd>
                  <Badge status={job.paymentStatus || "pending"} />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Category</dt>
                <dd className="font-medium">{categoryLabel(job.category)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Bids</dt>
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
                  <dt className="text-slate-500">Completed</dt>
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
              label="Report this professional"
            />
          )}
        </aside>
      </div>

      {scorePro && (
        <MatchScorePanel
          open={!!scorePro}
          onClose={() => setScorePro(null)}
          name={scorePro.name}
          score={scorePro.score}
          breakdown={scorePro.breakdown}
        />
      )}
      <BestValueExplainPanel
        open={!!bestValueExplain}
        onClose={() => setBestValueExplain(null)}
        row={bestValueExplain}
      />
    </Shell>
  );
}
