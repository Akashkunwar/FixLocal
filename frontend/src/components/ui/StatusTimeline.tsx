import clsx from "clsx";
import { JOB_TIMELINE, statusLabel, timelineIndex } from "../../lib/status";
import { t, tf } from "../../lib/i18n";

const labels: Record<string, string> = {
  open: "Posted",
  awarded: "Awarded",
  in_progress: "In progress",
  pending_confirmation: "Confirm",
  completed: "Completed",
};

export function StatusTimeline({ status }: { status: string }) {
  const idx = timelineIndex(status);
  if (status === "cancelled" || status === "disputed") {
    return (
      <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200">
        {t("Job is")}{" "}<strong>{statusLabel(status)}</strong>
      </div>
    );
  }

  const current = JOB_TIMELINE[Math.max(0, idx)];
  return (
    <>
      {/* Phones: a compact progress bar instead of five stacked rows */}
      <div className="sm:hidden">
        <div className="flex gap-1" aria-hidden>
          {JOB_TIMELINE.map((step, i) => (
            <span
              key={step}
              className={clsx(
                "h-1.5 flex-1 rounded-full",
                idx >= i ? "bg-brand-600" : "bg-slate-200",
              )}
            />
          ))}
        </div>
        <p className="mt-2 text-sm text-slate-500">
          {tf("Step {n} of {total}", { n: Math.max(0, idx) + 1, total: JOB_TIMELINE.length })} ·{" "}
          <strong className="text-slate-900">{t(labels[current])}</strong>
          {idx + 1 < JOB_TIMELINE.length && (
            <span className="text-slate-500">
              {" "}
              {t("· next:")}{" "}{t(labels[JOB_TIMELINE[idx + 1]])}
            </span>
          )}
        </p>
      </div>
      <ol className="hidden sm:flex sm:flex-row sm:items-center sm:gap-2">
        {JOB_TIMELINE.map((step, i) => {
          const done = idx >= i;
          const current = idx === i;
          return (
            <li key={step} className="flex items-center gap-2 flex-1">
              <div
                className={clsx(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  done
                    ? "bg-brand-700 text-white"
                    : "bg-slate-100 text-slate-500",
                  current && "ring-4 ring-brand-100",
                )}
              >
                {i + 1}
              </div>
              <span
                className={clsx(
                  "text-sm",
                  done ? "font-semibold text-slate-900" : "text-slate-500",
                )}
              >
                {t(labels[step])}
              </span>
              {i < JOB_TIMELINE.length - 1 && (
                <div
                  className={clsx(
                    "hidden sm:block h-0.5 flex-1 mx-1",
                    done && idx > i ? "bg-brand-500" : "bg-slate-200",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
