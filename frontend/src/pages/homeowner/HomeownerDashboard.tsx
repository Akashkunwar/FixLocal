import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import { listJobs, type Job } from "../../api/jobs";
import { Shell } from "../../components/Shell";

export function HomeownerDashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await listJobs({
        status: status || undefined,
        q: q.trim() || undefined,
        sort: "newest",
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

  return (
    <Shell title="My jobs">
      <div className="toolbar">
        <Link className="btn primary" to="/homeowner/jobs/new">
          Post a job
        </Link>
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <input
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="open">open</option>
            <option value="awarded">awarded</option>
            <option value="in_progress">in_progress</option>
            <option value="completed">completed</option>
            <option value="cancelled">cancelled</option>
            <option value="disputed">disputed</option>
          </select>
          <button type="submit" className="btn ghost">
            Filter
          </button>
        </form>
      </div>

      {error && <div className="alert">{error}</div>}
      {loading && <p className="muted">Loading jobs…</p>}
      {!loading && jobs.length === 0 && (
        <p className="muted">No jobs yet. Post your first repair job.</p>
      )}

      <ul className="list">
        {jobs.map((job) => (
          <li key={job.id}>
            <Link to={`/homeowner/jobs/${job.id}`} className="list-item">
              <div>
                <strong>{job.title}</strong>
                <div className="muted">
                  {job.category} · {job.area || "no area"}
                </div>
              </div>
              <span className={`badge status-${job.status}`}>{job.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
