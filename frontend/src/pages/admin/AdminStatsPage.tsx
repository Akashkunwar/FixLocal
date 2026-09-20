import { useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import { getAdminStats, getMatchQuality, type AdminStats, type MatchQualitySummary } from "../../api/admin";
import { Link } from "react-router-dom";
import { Spinner } from "../../components/ui/Spinner";
import { money } from "../../lib/format";

const PRIMARY: { key: keyof AdminStats; label: string }[] = [
  { key: "totalUsers", label: "Total users" },
  { key: "homeowners", label: "Clients" },
  { key: "tradespeople", label: "Professionals" },
  { key: "pendingVerifications", label: "Pending verifications" },
  { key: "openDisputes", label: "Open disputes" },
  { key: "suspendedUsers", label: "Suspended users" },
  { key: "openReports", label: "Open reports" },
];

const JOBS: { key: keyof AdminStats; label: string }[] = [
  { key: "openJobs", label: "Open" },
  { key: "awardedJobs", label: "Awarded" },
  { key: "inProgressJobs", label: "In progress" },
  { key: "pendingConfirmationJobs", label: "Awaiting confirmation" },
  { key: "completedJobs", label: "Completed" },
  { key: "disputedJobs", label: "Disputed" },
  { key: "cancelledJobs", label: "Cancelled" },
];

export function AdminStatsPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [match, setMatch] = useState<MatchQualitySummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getAdminStats(), getMatchQuality().catch(() => null)])
      .then(([s, m]) => {
        setStats(s.stats);
        if (m) setMatch(m.summary);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <Shell title="Admin overview" subtitle="Marketplace health at a glance">
      {loading || !stats ? (
        <Spinner />
      ) : (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PRIMARY.map(({ key, label }) => (
              <div key={key} className="card p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
                <p className="mt-2 font-display text-3xl font-semibold text-slate-900">
                  {stats[key] ?? 0}
                </p>
              </div>
            ))}
          </div>

          <section>
            <h2 className="font-semibold text-lg mb-3">Jobs by status</h2>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {JOBS.map(({ key, label }) => (
                <div key={key} className="card p-4 text-center">
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{stats[key] ?? 0}</p>
                </div>
              ))}
            </div>
          </section>

          {match && (
            <section className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-lg">Match quality (lite)</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Open jobs vs nearby verified pros (≤{match.radiusKm} km / same city)
                  </p>
                </div>
                <Link to="/admin/match" className="btn-secondary btn-sm no-underline">
                  Full table
                </Link>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-slate-400">No nearby</p>
                  <p className="text-xl font-semibold text-rose-700">{match.jobsWithNoNearby}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Thin</p>
                  <p className="text-xl font-semibold">{match.jobsThin}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">OK</p>
                  <p className="text-xl font-semibold">{match.jobsOk}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Strong</p>
                  <p className="text-xl font-semibold">{match.jobsStrong}</p>
                </div>
              </div>
            </section>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="card p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Active bids</p>
              <p className="mt-2 font-display text-3xl font-semibold">{stats.activeBids ?? 0}</p>
            </div>
            <div className="card p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Reviews</p>
              <p className="mt-2 font-display text-3xl font-semibold">{stats.totalReviews ?? 0}</p>
            </div>
            <div className="card p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Simulated GMV</p>
              <p className="mt-2 font-display text-3xl font-semibold text-brand-800">
                {money(stats.simulatedGMV ?? 0)}
              </p>
              <p className="mt-1 text-xs text-slate-400">Sum of accepted bids on completed jobs</p>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
