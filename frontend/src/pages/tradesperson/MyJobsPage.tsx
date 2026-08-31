import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import {
  completeJob,
  listJobs,
  startJob,
  type Job,
} from "../../api/jobs";
import { Shell } from "../../components/Shell";
import { ProNav } from "../../components/ProNav";

export function MyJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await listJobs({
        scope: "mine",
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

  async function onStart(id: string) {
    setActionError(null);
    setBusyId(id);
    try {
      await startJob(id);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not start job");
    } finally {
      setBusyId(null);
    }
  }

  async function onComplete(id: string) {
    setActionError(null);
    setBusyId(id);
    try {
      await completeJob(id);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not complete job");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Shell title="My awarded jobs">
      <ProNav />
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="awarded">awarded</option>
          <option value="in_progress">in_progress</option>
          <option value="completed">completed</option>
          <option value="disputed">disputed</option>
        </select>
        <button type="submit" className="btn ghost">
          Filter
        </button>
      </form>

      {error && <div className="alert">{error}</div>}
      {actionError && <div className="alert">{actionError}</div>}
      {loading && <p className="muted">Loading…</p>}
      {!loading && jobs.length === 0 && (
        <p className="muted">No awarded jobs yet. Bid on open jobs to get work.</p>
      )}

      <ul className="list">
        {jobs.map((job) => (
          <li key={job.id} className="list-item static">
            <div>
              <strong>{job.title}</strong>
              <div className="muted">
                {job.category} · {job.area || "—"}
              </div>
              <div className="btn-row">
                {job.status === "awarded" && (
                  <button
                    className="btn primary"
                    disabled={busyId === job.id}
                    onClick={() => onStart(job.id)}
                  >
                    Start work
                  </button>
                )}
                {job.status === "in_progress" && (
                  <button
                    className="btn primary"
                    disabled={busyId === job.id}
                    onClick={() => onComplete(job.id)}
                  >
                    Mark completed
                  </button>
                )}
                <Link to={`/tradesperson/jobs/${job.id}`}>View</Link>
              </div>
            </div>
            <span className={`badge status-${job.status}`}>{job.status}</span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
