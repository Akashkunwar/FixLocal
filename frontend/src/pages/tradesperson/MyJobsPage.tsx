import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Shell } from "../../components/Shell";
import { listJobs, getMyEarnings, type Job, type EarningsSummary } from "../../api/jobs";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { EmptyState } from "../../components/ui/EmptyState";
import { categoryLabel, fmtDate, money } from "../../lib/format";

export function MyJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [earnings, setEarnings] = useState<EarningsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      listJobs({ scope: "mine" }),
      getMyEarnings().catch(() => null),
    ])
      .then(([j, e]) => {
        setJobs(j.jobs);
        if (e) setEarnings(e.earnings);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <Shell title="My awarded jobs" subtitle="Jobs where your bid was accepted · earnings are simulated">
      {loading ? (
        <Spinner />
      ) : (
        <>
          {earnings && (
            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="card p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Earned (completed)</p>
                <p className="mt-1 font-display text-2xl font-semibold text-brand-800">
                  {money(earnings.totalEarned)}
                </p>
              </div>
              <div className="card p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Completed</p>
                <p className="mt-1 text-2xl font-semibold">{earnings.completedJobs}</p>
              </div>
              <div className="card p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">In progress / awarded</p>
                <p className="mt-1 text-2xl font-semibold">
                  {earnings.inProgressJobs + earnings.awardedJobs}
                </p>
              </div>
              <div className="card p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Active bids</p>
                <p className="mt-1 text-2xl font-semibold">{earnings.activeBids}</p>
              </div>
            </div>
          )}

          {jobs.length === 0 ? (
            <EmptyState
              title="No awarded jobs yet"
              description="Playbook: browse open jobs → bid with a clear quote + visit window → reply fast on counters → keep availability heat healthy."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Link to="/professional" className="btn-primary no-underline">Browse jobs</Link>
                  <Link to="/professional/profile" className="btn-secondary no-underline">Portfolio & rates</Link>
                </div>
              }
            />
          ) : (
            <ul className="grid gap-3">
              {jobs.map((job) => (
                <li key={job.id}>
                  <Link
                    to={`/professional/jobs/${job.id}`}
                    className="card flex flex-wrap items-center justify-between gap-4 p-5 no-underline text-inherit transition hover:shadow-lift"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">{job.title}</p>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {categoryLabel(job.category)}
                        {job.area ? ` · ${job.area}` : ""} · {fmtDate(job.createdAt)}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        Budget {money(job.budgetMin)} – {money(job.budgetMax)}
                      </p>
                    </div>
                    <Badge status={job.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Shell>
  );
}
