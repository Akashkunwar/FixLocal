import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Star } from "lucide-react";
import { listPendingReviews, type PendingReview } from "../api/extras";
import { t } from "../lib/i18n";

/** "How did it go?" prompt for completed jobs that still need a review. Renders nothing when there are none. */
export function PendingReviewsCard() {
  const [pending, setPending] = useState<PendingReview[]>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await listPendingReviews(ctrl.signal);
        if (!ctrl.signal.aborted) setPending(r.pending || []);
      } catch {
        // A missing prompt is harmless; never block the dashboard on it.
      }
    })();
    return () => ctrl.abort();
  }, []);

  if (!pending.length) return null;
  const [first, ...rest] = pending;
  return (
    <section
      className="card mb-6 border-amber-200 bg-amber-50/60 p-4 sm:p-5"
      aria-labelledby="pending-reviews-heading"
      data-testid="pending-reviews"
    >
      <div className="flex items-start gap-3">
        <Star className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="pending-reviews-heading" className="font-semibold text-slate-900">
            {pending.length === 1 ? t("How did it go?") : `${pending.length} finished jobs are waiting for your review`}
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {t("Rate")}{" "}{first.counterpartName} {t("for “")}{first.title}{t("” — it takes a few seconds.")}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link to={first.link} className="btn-primary btn-sm no-underline">
              {t("Leave a review")}
            </Link>
            {rest.slice(0, 3).map((p) => (
              <Link key={p.jobId} to={p.link} className="btn-ghost btn-sm no-underline">
                {p.title.length > 28 ? `${p.title.slice(0, 27)}…` : p.title}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
