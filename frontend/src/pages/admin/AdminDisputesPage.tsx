import { useEffect, useState, type FormEvent } from "react";
import { ApiError } from "../../api/client";
import { listDisputes, resolveDispute } from "../../api/admin";
import type { Dispute, Job } from "../../api/jobs";
import { Shell } from "../../components/Shell";
import { AdminNav } from "../../components/AdminNav";

type Row = Dispute & {
  job?: Job;
  reason: string;
  resolutionNotes?: string;
  raisedByUserId?: string;
};

export function AdminDisputesPage() {
  const [filter, setFilter] = useState("open");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function load(status = filter) {
    setLoading(true);
    setError(null);
    try {
      const res = await listDisputes(status || undefined);
      setRows(res.disputes as Row[]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load disputes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onResolve(
    e: FormEvent,
    id: string,
    resolution: "favor_homeowner" | "favor_tradesperson" | "no_action"
  ) {
    e.preventDefault();
    setBusyId(id);
    setError(null);
    try {
      await resolveDispute(id, {
        resolution,
        resolutionNotes: notes[id]?.trim() || undefined,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Resolve failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Shell title="Disputes">
      <AdminNav />
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="open">open</option>
          <option value="resolved">resolved</option>
          <option value="">all</option>
        </select>
        <button type="submit" className="btn ghost">
          Filter
        </button>
      </form>

      {error && <div className="alert">{error}</div>}
      {loading && <p className="muted">Loading…</p>}
      {!loading && rows.length === 0 && <p className="muted">No disputes.</p>}

      <ul className="list">
        {rows.map((d) => (
          <li key={d.id} className="panel">
            <div className="row-between">
              <strong>{d.job?.title || d.jobId}</strong>
              <span className={`badge status-${d.status}`}>{d.status}</span>
            </div>
            <p>{d.reason}</p>
            <p className="muted">
              Job status: {d.job?.status || "—"} · dispute {d.id.slice(0, 8)}…
            </p>
            {d.status === "open" && (
              <form className="form-grid">
                <label>
                  Notes
                  <input
                    value={notes[d.id] || ""}
                    onChange={(e) =>
                      setNotes((prev) => ({ ...prev, [d.id]: e.target.value }))
                    }
                    placeholder="Resolution notes"
                  />
                </label>
                <div className="btn-row">
                  <button
                    className="btn primary"
                    disabled={busyId === d.id}
                    onClick={(e) => onResolve(e, d.id, "favor_homeowner")}
                  >
                    Favor homeowner
                  </button>
                  <button
                    className="btn ghost"
                    disabled={busyId === d.id}
                    onClick={(e) => onResolve(e, d.id, "favor_tradesperson")}
                  >
                    Favor tradesperson
                  </button>
                  <button
                    className="btn ghost"
                    disabled={busyId === d.id}
                    onClick={(e) => onResolve(e, d.id, "no_action")}
                  >
                    No action
                  </button>
                </div>
              </form>
            )}
            {d.status === "resolved" && (
              <p className="muted">
                Resolved: {d.resolution}
                {d.resolutionNotes ? ` — ${d.resolutionNotes}` : ""}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Shell>
  );
}
