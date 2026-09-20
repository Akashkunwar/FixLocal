import { useEffect, useMemo, useState } from "react";
import type { Job } from "../api/jobs";
import {
  loadVisitPrepChecks,
  saveVisitPrepChecks,
  visitPrepItems,
} from "../lib/visitPrep";
import { ClipboardCheck } from "lucide-react";
import clsx from "clsx";

/** Client visit-prep checklist for proposed / confirmed visit windows. */
export function VisitPrepCard({ job }: { job: Job }) {
  const status = job.scheduleStatus || "none";
  const show =
    (job.status === "awarded" || job.status === "in_progress") &&
    (status === "proposed" || status === "confirmed");

  const items = useMemo(() => (show ? visitPrepItems(job) : []), [job, show]);
  const [checks, setChecks] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!show) return;
    setChecks(loadVisitPrepChecks(job.id));
  }, [job.id, show]);

  if (!show) return null;

  function toggle(id: string) {
    setChecks((prev) => {
      const next = { ...prev, [id]: !isDone(id, prev) };
      // Only persist explicit toggles that differ from autoDone baseline
      saveVisitPrepChecks(job.id, next);
      return next;
    });
  }

  function isDone(id: string, map = checks) {
    if (id in map) return !!map[id];
    return !!items.find((i) => i.id === id)?.autoDone;
  }

  const doneCount = items.filter((i) => isDone(i.id)).length;

  return (
    <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="visit-prep-heading">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2
            id="visit-prep-heading"
            className="font-semibold flex items-center gap-2 text-slate-900"
          >
            <ClipboardCheck className="h-4 w-4 text-brand-700" />
            Visit prep
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Soft checklist before the professional arrives
            {status === "confirmed" ? " (visit confirmed)" : " (visit proposed)"}.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
          {doneCount}/{items.length} ready
        </span>
      </div>
      <ul className="space-y-2" role="list">
        {items.map((item) => {
          const done = isDone(item.id);
          return (
            <li key={item.id}>
              <label
                className={clsx(
                  "flex cursor-pointer gap-3 rounded-xl px-3 py-2.5 ring-1 transition",
                  done
                    ? "bg-emerald-50/80 ring-emerald-100"
                    : "bg-slate-50 ring-slate-200 hover:bg-white"
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-700"
                  checked={done}
                  onChange={() => toggle(item.id)}
                  aria-describedby={`prep-hint-${item.id}`}
                />
                <span className="min-w-0">
                  <span
                    className={clsx(
                      "block text-sm font-medium",
                      done ? "text-emerald-900" : "text-slate-900"
                    )}
                  >
                    {item.label}
                  </span>
                  {item.hint && (
                    <span
                      id={`prep-hint-${item.id}`}
                      className="mt-0.5 block text-[11px] text-slate-500"
                    >
                      {item.hint}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
