import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { ApiError } from "../api/client";
import { keepJobOpen, type Job } from "../api/jobs";
import { useI18n } from "../lib/i18n";
import { fmtDate } from "../lib/format";

const DAY = 86400_000;

/** On the client's open job: when it closes if nobody is hired, with a "keep it open" button near the end. */
export function JobExpiryNotice({ job, onUpdated }: { job: Job; onUpdated: (j: Job) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (job.status !== "open" || !job.expiresAt) return null;
  const daysLeft = Math.max(0, Math.ceil((new Date(job.expiresAt).getTime() - Date.now()) / DAY));
  const soon = daysLeft <= 7;

  async function keep() {
    setBusy(true);
    setErr(null);
    try {
      onUpdated((await keepJobOpen(job.id)).job);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("Something went wrong. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-xl p-3 text-sm ring-1 ${soon ? "bg-amber-50 text-amber-950 ring-amber-200" : "bg-slate-50 text-slate-700 ring-slate-200"}`}
      data-testid="job-expiry"
    >
      <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        {t("Listed until")} <strong>{fmtDate(job.expiresAt)}</strong>
        {soon ? ` · ${t("closes automatically if nobody is hired.")}` : ""}
      </p>
      {soon && (
        <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={keep}>
          {t("Keep open 30 more days")}
        </button>
      )}
      {err && (
        <p className="w-full text-red-700" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}
