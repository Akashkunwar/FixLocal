import { FormEvent, useState } from "react";
import { createDispute } from "../../../api/jobs";
import { useToast } from "../../../components/Toast";

/** Open a dispute with a reason and up to five evidence files. */
export function DisputeForm({
  jobId,
  onOpened,
  onCancel,
}: {
  jobId: string;
  onOpened: () => void;
  onCancel: () => void;
}) {
  const { success, error } = useToast();
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createDispute(jobId, { reason, files });
      success("Dispute opened with evidence");
      onOpened();
    } catch (err) {
      error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200"
    >
      <label className="label" htmlFor="dispute-reason">
        Why are you disputing?
      </label>
      <textarea
        id="dispute-reason"
        className="input"
        required
        maxLength={4000}
        placeholder="Describe the issue clearly for the admin."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div>
        <label className="label" htmlFor="dispute-evidence">
          Evidence (photos or PDF, up to 5)
        </label>
        <input
          id="dispute-evidence"
          className="input"
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          multiple
          onChange={(e) =>
            setFiles(Array.from(e.target.files || []).slice(0, 5))
          }
        />
        {files.length > 0 && (
          <p className="mt-1 text-xs text-slate-600">
            {files.length} file(s) attached
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary btn-sm" disabled={busy}>
          {busy ? "Submitting…" : "Submit dispute"}
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
