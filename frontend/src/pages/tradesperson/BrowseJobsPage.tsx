import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import { getProfile, listJobs, type Job, type TradespersonProfile } from "../../api/jobs";
import { Shell } from "../../components/Shell";
import { ProNav } from "../../components/ProNav";

export function BrowseJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [profile, setProfile] = useState<TradespersonProfile | null>(null);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [jobsRes, profileRes] = await Promise.all([
        listJobs({
          q: q.trim() || undefined,
          category: category || undefined,
          sort: "newest",
          limit: "20",
        }),
        getProfile(),
      ]);
      setJobs(jobsRes.jobs);
      setProfile(profileRes.profile);
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

  const verified = profile?.verificationStatus === "verified";

  return (
    <Shell title="Open jobs">
      <ProNav />
      {!verified && profile && (
        <div className="alert">
          Your account is <strong>{profile.verificationStatus}</strong>. You cannot place
          bids until an admin verifies you.
        </div>
      )}
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
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          <option value="plumbing">plumbing</option>
          <option value="electrical">electrical</option>
          <option value="carpentry">carpentry</option>
          <option value="painting">painting</option>
          <option value="appliance">appliance</option>
          <option value="other">other</option>
        </select>
        <button type="submit" className="btn ghost">
          Filter
        </button>
      </form>

      {error && <div className="alert">{error}</div>}
      {loading && <p className="muted">Loading…</p>}
      {!loading && jobs.length === 0 && <p className="muted">No open jobs found.</p>}

      <ul className="list">
        {jobs.map((job) => (
          <li key={job.id}>
            <Link to={`/tradesperson/jobs/${job.id}`} className="list-item">
              <div>
                <strong>{job.title}</strong>
                <div className="muted">
                  {job.category} · {job.area || "—"} · budget {job.budgetMax ?? "—"}
                </div>
              </div>
              <span className="badge status-open">{job.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
