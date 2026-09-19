import { FormEvent, useState } from "react";
import { createReview, type JobReview } from "../../../api/extras";
import { StarRating } from "../../../components/ui/StarRating";
import { useToast } from "../../../components/Toast";

/** The client's review of the professional, plus the professional's rating of the client. */
export function ReviewPanel({
  jobId,
  review,
  proReview,
  onSaved,
}: {
  jobId: string;
  review: JobReview | null;
  proReview: JobReview | null;
  onSaved: () => void;
}) {
  const { success, error } = useToast();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await createReview(jobId, rating, comment);
      success("Thanks for your review!");
      onSaved();
    } catch (err) {
      error((err as Error).message);
    }
  }

  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold mb-3">Review</h2>
      {proReview && (
        <p className="mb-3 text-sm text-slate-600">
          The professional rated working with you {proReview.rating}/5
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
            aria-label="Review comment"
            maxLength={2000}
            placeholder="How was the experience?"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button type="submit" className="btn-primary">
            Submit review
          </button>
        </form>
      )}
    </section>
  );
}
