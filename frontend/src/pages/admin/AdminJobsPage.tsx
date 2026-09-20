import { useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import { listJobs, type Job } from "../../api/jobs";
import { forceCancelJob } from "../../api/admin";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/ui/EmptyState";
import { categoryLabel, fmtDate } from "../../lib/format";

export function AdminJobsPage() {
  const { success, error } = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await listJobs({ limit: "50" });
      setJobs(r.jobs);
    } catch (e) {
      error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when the page opens
  }, []);

  async function cancel(id: string) {
    const reason = window.prompt(
      "Force-cancel this job? Any unreleased payment is refunded and both sides are notified.\n\nReason (shown to the users):",
      "Cancelled by FixLocal support"
    );
    if (reason === null) return;
    try {
      const r = await forceCancelJob(id, reason.trim() || undefined);
      success(`Job cancelled (was ${r.previousStatus.replace(/_/g, " ")})`);
      load();
    } catch (e) {
      error((e as Error).message);
    }
  }

  return (
    <Shell title="All jobs" subtitle="Monitor and force-cancel if needed">
      {loading ? (
        <Spinner />
      ) : jobs.length === 0 ? (
        <EmptyState title="No jobs yet" description="Jobs will appear here once clients post them." />
      ) : (
        <ul className="grid gap-3">
          {jobs.map((j) => (
            <li key={j.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-semibold">{j.title}</p>
                <p className="text-sm text-slate-500">{categoryLabel(j.category)} · {fmtDate(j.createdAt)}</p>
                <div className="mt-1"><Badge status={j.status} /></div>
              </div>
              {j.status !== "cancelled" && j.status !== "completed" && (
                <button type="button" className="btn-danger btn-sm" onClick={() => cancel(j.id)}>Force cancel</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
