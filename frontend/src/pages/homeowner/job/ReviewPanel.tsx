import { FormEvent, useEffect, useRef, useState } from "react";
import { createReview, type JobReview } from "../../../api/extras";
import { StarRating } from "../../../components/ui/StarRating";
import { useToast } from "../../../components/Toast";
import { t } from "../../../lib/i18n";

/** The client's review of the professional, plus the professional's rating of the client. */
export function ReviewPanel({
  jobId,
  review,
  proReview,
  onSaved,
  proName,
}: {
  jobId: string;
  review: JobReview | null;
  proReview: JobReview | null;
  onSaved: () => void;
  proName?: string | null;
}) {
  const { success, error } = useToast();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLElement>(null);

  // Notification / dashboard prompts deep-link to #review.
  useEffect(() => {
    if (window.location.hash !== "#review") return;
    const timer = window.setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    return () => window.clearTimeout(timer);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await createReview(jobId, rating, comment);
      success("Thanks for your review!");
      onSaved();
    } catch (err) {
      error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id="review"
      ref={ref}
      aria-labelledby="review-heading"
      className={`card scroll-mt-24 p-6 ${review ? "" : "ring-2 ring-brand-200"}`}
    >
      <h2 id="review-heading" className="text-lg font-semibold">
        {review ? t("Your review") : `How did it go${proName ? ` with ${proName}` : ""}?`}
      </h2>
      {!review && (
        <p className="mb-3 mt-1 text-sm text-slate-600">
          {t("A quick rating helps other clients choose — and helps good pros get more work.")}
        </p>
      )}
      {review && <div className="mb-3" />}
      {proReview && (
        <p className="mb-3 text-sm text-slate-600">
          {t("The professional rated working with you")}{" "}{proReview.rating}/5
          {proReview.comment ? `: “${proReview.comment}”` : "."}
        </p>
      )}
      {review ? (
        <div>
          <StarRating value={review.rating} readonly />
          {review.comment && (
            <p className="mt-2 text-sm text-slate-600">{review.comment}</p>
          )}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <StarRating value={rating} onChange={setRating} />
          <textarea
            className="input"
            aria-label={t("Review comment")}
            maxLength={2000}
            placeholder={t("How was the experience?")}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? t("Saving…") : t("Submit review")}
          </button>
        </form>
      )}
    </section>
  );
}
