import { FormEvent, useState } from "react";
import { cancelBooking } from "../api/jobs";
import { useToast } from "./Toast";
import { money } from "../lib/format";

type Props = { jobId: string; side: "client" | "professional"; onDone: () => void };

/** Calls off a hired job before work starts. Every milestone still held is refunded to the client. */
export function CancelBookingButton({ jobId, side, onDone }: Props) {
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await cancelBooking(jobId, reason.trim() || undefined);
      success(
        r.refunded > 0
          ? `Booking cancelled. ${money(r.refunded)} held in escrow was refunded to the client.`
          : "Booking cancelled.",
      );
      setOpen(false);
      onDone();
    } catch (err) {
      error((err as Error).message || "Couldn't cancel the booking");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn-ghost text-rose-700" onClick={() => setOpen(true)}>
        Cancel booking
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="card w-full space-y-3 border-rose-200 p-4" aria-labelledby={`cb-${jobId}`}>
      <h3 id={`cb-${jobId}`} className="font-semibold text-rose-800">Cancel this booking?</h3>
      <p className="text-sm text-slate-600">
        {side === "client"
          ? "The professional hasn't started yet. Any payment still held in escrow is refunded to you; a deposit you already released stays with the professional. The job closes and can't be reopened."
          : "You haven't started yet. Any payment still held in escrow goes back to the client and the job closes. Frequent cancellations can affect your standing."}
      </p>
      <div>
        <label className="label" htmlFor={`cb-reason-${jobId}`}>Reason (shared with the other side)</label>
        <textarea
          id={`cb-reason-${jobId}`}
          className="input"
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={side === "client" ? "e.g. Plans changed" : "e.g. Can't make the date"}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-danger" disabled={busy}>
          {busy ? "Cancelling…" : "Yes, cancel booking"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Keep booking
        </button>
      </div>
    </form>
  );
}

/** Explains who called a booking off, and why. */
export function CancellationNote({ cancelledBy, reason }: { cancelledBy?: string | null; reason?: string | null }) {
  if (!cancelledBy) return null;
  const who = cancelledBy === "client" ? "the client" : "the professional";
  return (
    <p className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700" role="status" data-testid="cancellation-note">
      Booking cancelled by {who} before work started{reason ? `: “${reason}”` : "."} Any payment still held was refunded.
    </p>
  );
}
