import clsx from "clsx";
import { JOB_TIMELINE, timelineIndex } from "../../lib/status";

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
        Job is <strong>{status}</strong>
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-0 sm:flex-row sm:items-center sm:gap-2">
      {JOB_TIMELINE.map((step, i) => {
        const done = idx >= i;
        const current = idx === i;
        return (
          <li key={step} className="flex items-center gap-2 flex-1">
            <div
              className={clsx(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                done ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-400",
                current && "ring-4 ring-brand-100"
              )}
            >
              {i + 1}
            </div>
            <span className={clsx("text-sm", done ? "font-semibold text-slate-900" : "text-slate-400")}>
              {labels[step]}
            </span>
            {i < JOB_TIMELINE.length - 1 && (
              <div className={clsx("hidden sm:block h-0.5 flex-1 mx-1", done && idx > i ? "bg-brand-500" : "bg-slate-200")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
