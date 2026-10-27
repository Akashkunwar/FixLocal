import { FormEvent, useState } from "react";
import { MessageCircleReply } from "lucide-react";
import { ApiError } from "../api/client";
import { replyToReview, type PublicReview } from "../api/jobs";
import { useI18n } from "../lib/i18n";

/** The professional's public reply under a review; the reviewed pro can write, edit or remove it. */
export function ReviewReply({ review, canReply, onChange }: { review: PublicReview; canReply: boolean; onChange: (r: PublicReview) => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(review.reply ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fieldId = `reply-${review.id}`;

  async function save(e: FormEvent, value = text) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await replyToReview(review.id, value.trim());
      onChange({ ...review, reply: r.review.reply ?? null, repliedAt: r.review.repliedAt ?? null });
      setText(r.review.reply ?? "");
      setEditing(false);
    } catch (error) {
      setErr(error instanceof ApiError ? error.message : t("Something went wrong. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={save} className="mt-2 space-y-2">
        <label htmlFor={fieldId} className="label">
          {t("Your public reply")}
        </label>
        <textarea id={fieldId} className="input min-h-20" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
        {err && (
          <p className="text-sm text-red-700" role="alert">
            {err}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary" disabled={busy || !text.trim()}>
            {t("Post reply")}
          </button>
          {review.reply && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={(e) => void save(e as unknown as FormEvent, "")}>
              {t("Remove reply")}
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
            {t("Cancel")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <>
      {review.reply && (
        <div className="mt-2 rounded-lg border-l-4 border-brand-200 bg-slate-50 p-3 text-sm text-slate-700" data-testid="review-reply">
          <p className="text-xs font-semibold text-slate-600">{t("Reply from the professional")}</p>
          <p className="mt-1 whitespace-pre-line">{review.reply}</p>
        </div>
      )}
      {canReply && (
        <button type="button" className="btn-ghost mt-2 inline-flex items-center gap-1 text-sm" onClick={() => setEditing(true)}>
          <MessageCircleReply className="h-4 w-4" aria-hidden /> {review.reply ? t("Edit reply") : t("Reply publicly")}
        </button>
      )}
    </>
  );
}
