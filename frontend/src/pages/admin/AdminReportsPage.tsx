import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Shell } from "../../components/Shell";
import { listReports, resolveReport, type AdminReport } from "../../api/admin";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { EmptyState } from "../../components/ui/EmptyState";
import { useToast } from "../../components/Toast";
import { fmtDateTime } from "../../lib/format";

const FILTERS = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
] as const;

function targetLink(r: AdminReport) {
  if (r.targetType === "job") return `/admin/jobs?focus=${r.targetId}`;
  if (r.targetType === "user") return `/admin/users?q=${r.targetId}`;
  return null;
}

export function AdminReportsPage() {
  const { success, error } = useToast();
  const [status, setStatus] = useState<AdminReport["status"]>("open");
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReports((await listReports(status)).reports);
    } catch (e) {
      error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status, error]);

  useEffect(() => {
    void load();
  }, [load]);

  async function close(r: AdminReport, next: "resolved" | "dismissed") {
    try {
      await resolveReport(r.id, next, notes[r.id]);
      success(next === "resolved" ? "Report resolved" : "Report dismissed");
      void load();
    } catch (e) {
      error((e as Error).message);
    }
  }

  return (
    <Shell title="Reports" subtitle="Jobs, users and messages flagged by the community">
      <div className="mb-4 flex gap-2" role="group" aria-label="Filter reports">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={status === f.value}
            className={status === f.value ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
            onClick={() => setStatus(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {loading ? (
        <Spinner />
      ) : reports.length === 0 ? (
        <EmptyState title="Nothing here" description="No reports in this filter." />
      ) : (
        <ul className="grid gap-3">
          {reports.map((r) => {
            const link = targetLink(r);
            return (
              <li key={r.id} className="card space-y-2 p-5">
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <Badge status={r.status} />
                  <span className="font-medium capitalize text-slate-800">{r.targetType}</span>
                  {link ? (
                    <Link className="font-mono text-xs text-brand-700 underline" to={link}>
                      {r.targetId}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs">{r.targetId}</span>
                  )}
                  <span>· {fmtDateTime(r.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap text-slate-800">{r.reason}</p>
                <p className="text-xs text-slate-500">
                  Reported by {r.reporter?.name || r.reporter?.email || "a user"}
                </p>
                {r.status === "open" ? (
                  <div className="space-y-2">
                    <label className="label" htmlFor={`note-${r.id}`}>
                      Note (saved to the audit log)
                    </label>
                    <textarea
                      id={`note-${r.id}`}
                      className="input"
                      value={notes[r.id] || ""}
                      onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                    />
                    <div className="flex gap-2">
                      <button type="button" className="btn-primary btn-sm" onClick={() => close(r, "resolved")}>
                        Mark resolved
                      </button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => close(r, "dismissed")}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                ) : (
                  r.resolutionNote && <p className="rounded-xl bg-slate-50 p-3 text-sm">{r.resolutionNote}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}
