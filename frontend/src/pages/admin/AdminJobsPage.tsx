import { useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import { listJobs, type Job } from "../../api/jobs";
import { forceCancelJob } from "../../api/admin";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/ui/EmptyState";
import { categoryLabel, fmtDate } from "../../lib/format";

import { t, tf } from "../../lib/i18n";
import { errorText } from "../../lib/apiErrors";
import { statusLabel } from "../../lib/status";
import { useConfirm } from "../../components/ConfirmDialog";
export function AdminJobsPage() {
  const { success, error } = useToast();
  const { prompt } = useConfirm();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await listJobs({ limit: "50" });
      setJobs(r.jobs);
    } catch (e) {
      error(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when the page opens
  }, []);

  async function cancel(id: string) {
    const reason = await prompt({
      title: t("Force-cancel this job?"),
      message: t("Any unreleased payment is refunded and both sides are notified."),
      label: t("Reason (shown to the users)"),
      defaultValue: t("Cancelled by FixLocal support"),
      confirmLabel: t("Force-cancel"),
      danger: true,
      maxLength: 500,
    });
    if (reason === null) return;
    try {
      const r = await forceCancelJob(id, reason.trim() || undefined);
      success(tf("Job cancelled (was {status})", { status: statusLabel(r.previousStatus) }));
      load();
    } catch (e) {
      error(errorText(e));
    }
  }

  return (
    <Shell title={t("All jobs")} subtitle={t("Monitor and force-cancel if needed")}>
      {loading ? (
        <Spinner />
      ) : jobs.length === 0 ? (
        <EmptyState title={t("No jobs yet")} description={t("Jobs will appear here once clients post them.")} />
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
                <button type="button" className="btn-danger btn-sm" onClick={() => cancel(j.id)}>{t("Force cancel")}</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
