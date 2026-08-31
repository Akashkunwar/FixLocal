import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { forceCancelJob } from "../../api/admin";
import { listJobs, type Job } from "../../api/jobs";
import { Shell } from "../../components/Shell";
import { AdminNav } from "../../components/AdminNav";

export function AdminJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState("open");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await listJobs({
        status: status || undefined,
        sort: "newest",
        limit: "30",
      });
      setJobs(res.jobs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onForceCancel(id: string) {
    if (!confirm("Force-cancel this job?")) return;
    setBusyId(id);
    setError(null);
    try {
      await forceCancelJob(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Force-cancel failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Shell title="Jobs (moderation)">
      <AdminNav />
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">open</option>
          <option value="awarded">awarded</option>
          <option value="in_progress">in_progress</option>
          <option value="disputed">disputed</option>
          <option value="cancelled">cancelled</option>
          <option value="">all</option>
        </select>
        <button type="submit" className="btn ghost">
          Filter
        </button>
      </form>

      {error && <div className="alert">{error}</div>}
      {loading && <p className="muted">Loading…</p>}
      {!loading && jobs.length === 0 && <p className="muted">No jobs.</p>}

      <ul className="list">
        {jobs.map((job) => (
          <li key={job.id} className="list-item static">
            <div>
              <strong>{job.title}</strong>
              <div className="muted">
                {job.category} · {job.area || "—"} · {job.status}
              </div>
              {job.status !== "cancelled" && job.status !== "completed" && (
                <div className="btn-row">
                  <button
                    className="btn ghost"
                    disabled={busyId === job.id}
                    onClick={() => onForceCancel(job.id)}
                  >
                    Force cancel
                  </button>
                </div>
              )}
            </div>
            <span className={`badge status-${job.status}`}>{job.status}</span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
