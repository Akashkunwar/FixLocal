import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { getAdminStats, type AdminStats } from "../../api/admin";
import { Shell } from "../../components/Shell";
import { AdminNav } from "../../components/AdminNav";

export function AdminStatsPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminStats()
      .then((res) => setStats(res.stats))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load stats")
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <Shell title="Admin dashboard">
      <AdminNav />
      {loading && <p className="muted">Loading stats…</p>}
      {error && <div className="alert">{error}</div>}
      {stats && (
        <div className="stats-grid">
          <div className="stat">
            <div className="stat-value">{stats.totalUsers}</div>
            <div className="muted">Total users</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats.homeowners}</div>
            <div className="muted">Homeowners</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats.tradespeople}</div>
            <div className="muted">Tradespeople</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats.openJobs}</div>
            <div className="muted">Open jobs</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats.openDisputes}</div>
            <div className="muted">Open disputes</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats.pendingVerifications}</div>
            <div className="muted">Pending verifications</div>
          </div>
        </div>
      )}
    </Shell>
  );
}
