import { FormEvent, useMemo, useState } from "react";
import { proposeSchedule, acceptSchedule, type Job } from "../api/jobs";
import { Badge } from "./ui/Badge";
import { fmtDateTime } from "../lib/format";
import { useToast } from "./Toast";
import { CalendarClock, CalendarPlus } from "lucide-react";
import { downloadVisitIcs, googleCalendarUrl, outlookCalendarUrl } from "../lib/ics";
import {
  availabilityConflictHint,
  formatAvailabilitySummary,
  type WeeklyAvailability,
} from "../lib/availability";

function toLocalInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SchedulePanel({
  job,
  userId,
  canManage,
  onChanged,
  proAvailability,
  blockedDates,
}: {
  job: Job;
  userId?: string;
  canManage: boolean;
  onChanged?: () => void;
  proAvailability?: WeeklyAvailability | null;
  blockedDates?: string[] | null;
}) {
  const { success, error } = useToast();
  const [start, setStart] = useState(toLocalInput(job.scheduledStart) || toLocalInput(job.preferredStart));
  const [end, setEnd] = useState(toLocalInput(job.scheduledEnd) || toLocalInput(job.preferredEnd));
  const [note, setNote] = useState(job.scheduleNote || "");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const status = job.scheduleStatus || "none";
  const iProposed = !!userId && job.scheduleProposedByUserId === userId;
  const canAccept =
    canManage && status === "proposed" && !iProposed && !!job.scheduledStart;

  const conflict = useMemo(() => {
    if (!start) return null;
    try {
      return availabilityConflictHint(
        proAvailability,
        new Date(start).toISOString(),
        end ? new Date(end).toISOString() : undefined,
        blockedDates
      );
    } catch {
      return null;
    }
  }, [start, end, proAvailability, blockedDates]);

  const existingConflict = useMemo(() => {
    if (!job.scheduledStart) return null;
    return availabilityConflictHint(
      proAvailability,
      job.scheduledStart,
      job.scheduledEnd || undefined,
      blockedDates
    );
  }, [job.scheduledStart, job.scheduledEnd, proAvailability, blockedDates]);

  async function onPropose(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await proposeSchedule(job.id, {
        start: new Date(start).toISOString(),
        end: end ? new Date(end).toISOString() : undefined,
        note: note || undefined,
      });
      success("Visit window proposed");
      setShowForm(false);
      onChanged?.();
    } catch (err: any) {
      error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onAccept() {
    setBusy(true);
    try {
      await acceptSchedule(job.id);
      success("Visit time confirmed");
      onChanged?.();
    } catch (err: any) {
      error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const manageable =
    canManage && (job.status === "awarded" || job.status === "in_progress");

  return (
    <section className="card p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-brand-700" /> Visit schedule
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Propose or confirm a visit window on the job timeline.
          </p>
        </div>
        <Badge status={status === "none" ? "pending" : status} />
      </div>

      {(blockedDates?.length ?? 0) > 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
          Blocked dates: {blockedDates!.slice(0, 8).join(", ")}
          {(blockedDates!.length > 8) ? "…" : ""}
        </p>
      )}
      {proAvailability && (
        <p className="text-xs text-slate-500 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
          Pro usual hours: {formatAvailabilitySummary(proAvailability)}
        </p>
      )}

      {(job.preferredStart || job.preferredEnd) && (
        <p className="text-sm text-slate-600">
          Client preferred:{" "}
          <strong>
            {fmtDateTime(job.preferredStart)}
            {job.preferredEnd ? ` – ${fmtDateTime(job.preferredEnd)}` : ""}
          </strong>
        </p>
      )}

      {job.scheduledStart && (
        <div className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-950 ring-1 ring-brand-100">
          <p className="font-medium">
            {status === "confirmed" ? "Confirmed visit" : "Proposed visit"}
          </p>
          <p className="mt-0.5">
            {fmtDateTime(job.scheduledStart)}
            {job.scheduledEnd ? ` – ${fmtDateTime(job.scheduledEnd)}` : ""}
          </p>
          {job.scheduleNote && <p className="mt-1 text-xs text-brand-800/80">{job.scheduleNote}</p>}
          {existingConflict && (
            <p className="mt-2 text-xs font-medium text-amber-800 bg-amber-50 rounded-lg px-2 py-1.5 ring-1 ring-amber-200">
              {existingConflict}
            </p>
          )}
        </div>
      )}

      {status === "confirmed" && job.scheduledStart && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary btn-sm touch-target"
            onClick={() => {
              try {
                downloadVisitIcs(job);
                success("Calendar file downloaded (.ics, Asia/Kolkata)");
              } catch (err: any) {
                error(err.message || "Could not export calendar");
              }
            }}
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            Download .ics
          </button>
          <a
            className="btn-ghost btn-sm touch-target no-underline"
            href={googleCalendarUrl(job)}
            target="_blank"
            rel="noreferrer"
          >
            Google Calendar
          </a>
          <a
            className="btn-ghost btn-sm touch-target no-underline"
            href={outlookCalendarUrl(job)}
            target="_blank"
            rel="noreferrer"
          >
            Outlook
          </a>
        </div>
      )}

      {manageable && (
        <div className="flex flex-wrap gap-2">
          {canAccept && (
            <button type="button" className="btn-primary btn-sm touch-target" disabled={busy} onClick={onAccept}>
              Accept time
            </button>
          )}
          <button
            type="button"
            className="btn-secondary btn-sm touch-target"
            onClick={() => setShowForm((v) => !v)}
          >
            {status === "none" ? "Propose time" : "Counter-propose"}
          </button>
        </div>
      )}

      {showForm && manageable && (
        <form onSubmit={onPropose} className="space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="schedule-start">Start</label>
              <input
                id="schedule-start"
                className="input"
                type="datetime-local"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="schedule-end">End</label>
              <input
                id="schedule-end"
                className="input"
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
          {conflict && (
            <p className="text-xs font-medium text-amber-800 bg-amber-50 rounded-lg px-2.5 py-2 ring-1 ring-amber-200">
              {conflict} You can still propose — this is only a hint.
            </p>
          )}
          <div>
            <label className="label" htmlFor="schedule-note">Note (optional)</label>
            <input
              id="schedule-note"
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. morning slot, bring ladder"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary btn-sm touch-target" disabled={busy}>
              {busy ? "Saving…" : "Send proposal"}
            </button>
            <button type="button" className="btn-ghost btn-sm touch-target" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
