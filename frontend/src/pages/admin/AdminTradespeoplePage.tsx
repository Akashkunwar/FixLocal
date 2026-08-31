import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import {
  listTradespeople,
  verifyTradesperson,
  type AdminTradesperson,
} from "../../api/admin";
import { Shell } from "../../components/Shell";
import { AdminNav } from "../../components/AdminNav";

export function AdminTradespeoplePage() {
  const [filter, setFilter] = useState("pending");
  const [rows, setRows] = useState<AdminTradesperson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load(status = filter) {
    setLoading(true);
    setError(null);
    try {
      const res = await listTradespeople(status || undefined);
      setRows(res.tradespeople);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setStatus(
    userId: string,
    status: "verified" | "rejected" | "suspended" | "pending"
  ) {
    setBusyId(userId);
    setError(null);
    try {
      await verifyTradesperson(userId, status);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Shell title="Verify tradespeople">
      <AdminNav />
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="pending">pending</option>
          <option value="verified">verified</option>
          <option value="rejected">rejected</option>
          <option value="suspended">suspended</option>
          <option value="">all</option>
        </select>
        <button type="submit" className="btn ghost">
          Filter
        </button>
      </form>

      {error && <div className="alert">{error}</div>}
      {loading && <p className="muted">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="muted">No tradespeople for this filter.</p>
      )}

      <ul className="list">
        {rows.map((t) => (
          <li key={t.id} className="list-item static">
            <div>
              <strong>{t.email || t.userId}</strong>
              <div className="muted">
                {t.verificationStatus}
                {t.skills ? ` · ${t.skills}` : ""}
              </div>
              <div className="btn-row">
                <button
                  className="btn primary"
                  disabled={busyId === t.userId}
                  onClick={() => setStatus(t.userId, "verified")}
                >
                  Verify
                </button>
                <button
                  className="btn ghost"
                  disabled={busyId === t.userId}
                  onClick={() => setStatus(t.userId, "rejected")}
                >
                  Reject
                </button>
                <button
                  className="btn ghost"
                  disabled={busyId === t.userId}
                  onClick={() => setStatus(t.userId, "suspended")}
                >
                  Suspend
                </button>
              </div>
            </div>
            <span className={`badge status-${t.verificationStatus}`}>
              {t.verificationStatus}
            </span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
