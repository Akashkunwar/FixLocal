import { useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import { listDisputes, resolveDispute } from "../../api/admin";
import { getJobPayments, mediaUrl, type Dispute, type PaymentMilestone } from "../../api/jobs";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { EmptyState } from "../../components/ui/EmptyState";
import { useToast } from "../../components/Toast";
import { fmtDateTime, money } from "../../lib/format";

export function AdminDisputesPage() {
  const { success, error } = useToast();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "resolved" | "">("open");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [jobStatus, setJobStatus] = useState<Record<string, "" | "cancelled" | "completed" | "restore">>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [milestonesByJob, setMilestonesByJob] = useState<Record<string, PaymentMilestone[]>>({});
  const [refundSel, setRefundSel] = useState<Record<string, string[]>>({});

  async function load() {
    setLoading(true);
    try {
      const r = await listDisputes(filter || undefined);
      setDisputes(r.disputes);
      const open = r.disputes.filter((d) => d.status === "open" && d.jobId);
      const map: Record<string, PaymentMilestone[]> = {};
      await Promise.all(
        open.map(async (d) => {
          try {
            const pay = await getJobPayments(d.jobId);
            map[d.jobId] = pay.milestones;
          } catch {
            map[d.jobId] = [];
          }
        })
      );
      setMilestonesByJob(map);
    } catch (e) {
      error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the filter changes; load() reads it
  }, [filter]);

  function toggleRefund(disputeId: string, milestoneId: string) {
    const cur = refundSel[disputeId] || [];
    const next = cur.includes(milestoneId)
      ? cur.filter((id) => id !== milestoneId)
      : [...cur, milestoneId];
    setRefundSel({ ...refundSel, [disputeId]: next });
  }

  async function resolve(
    id: string,
    resolution: "favor_homeowner" | "favor_tradesperson" | "no_action"
  ) {
    setBusyId(id);
    try {
      const r = await resolveDispute(id, {
        resolution,
        resolutionNotes: notes[id] || undefined,
        jobStatus: jobStatus[id] || undefined,
        refundMilestoneIds: refundSel[id]?.length ? refundSel[id] : undefined,
      });
      const refunded = r.dispute.refundMeta?.totalRefunded;
      const released = r.dispute.refundMeta?.totalReleased;
      const parts = [
        refunded ? `₹${Number(refunded).toFixed(0)} refunded` : null,
        released ? `₹${Number(released).toFixed(0)} released` : null,
      ].filter(Boolean);
      success(`Dispute resolved · job is now ${r.job.status.replace(/_/g, " ")}${parts.length ? ` · ${parts.join(" · ")} (simulated)` : ""}`);
      load();
    } catch (e) {
      error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Shell title="Disputes" subtitle="Review evidence, reverse escrow milestones, and set post-resolution job status">
      <div className="mb-4 flex gap-2">
        {(["open", "resolved", ""] as const).map((f) => (
          <button
            key={f || "all"}
            type="button"
            className={filter === f ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
            onClick={() => setFilter(f)}
          >
            {f === "" ? "All" : f === "open" ? "Open" : "Resolved"}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : disputes.length === 0 ? (
        <EmptyState title="No disputes" description="Nothing in this filter right now." />
      ) : (
        <ul className="grid gap-4">
          {disputes.map((d) => {
            const milestones = milestonesByJob[d.jobId] || [];
            return (
              <li key={d.id} className="card p-5 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge status={d.status} />
                  {d.resolution && <Badge status={d.resolution} />}
                  <span className="text-sm text-slate-500">Job: {d.job?.title || d.jobId}</span>
                  {d.job?.status && <span className="text-xs text-slate-400">· job {d.job.status}</span>}
                </div>
                <p className="text-slate-800 whitespace-pre-wrap">{d.reason}</p>
                <p className="text-xs text-slate-500">
                  Raised by {d.raisedBy?.name || d.raisedBy?.email || "party"} · {fmtDateTime(d.createdAt)}
                </p>

                {(d.evidenceUrls?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Evidence</p>
                    <ul className="flex flex-wrap gap-2">
                      {d.evidenceUrls!.map((url) => {
                        const href = mediaUrl(url);
                        const isPdf = url.split("?")[0].toLowerCase().endsWith(".pdf");
                        return (
                          <li key={url}>
                            {isPdf ? (
                              <a href={href} target="_blank" rel="noreferrer" className="btn-secondary btn-sm no-underline">
                                View PDF
                              </a>
                            ) : (
                              <a href={href} target="_blank" rel="noreferrer" className="block h-20 w-20 overflow-hidden rounded-lg ring-1 ring-slate-200">
                                <img src={href} alt="Evidence" className="h-full w-full object-cover" />
                              </a>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {d.status === "open" && (
                  <>
                    {milestones.length > 0 && (
                      <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Escrow refund / reverse (simulated)
                        </p>
                        <ul className="space-y-1.5">
                          {milestones.map((m) => {
                            const checked = (refundSel[d.id] || []).includes(m.id);
                            const already = m.status === "refunded";
                            const released = m.status === "released";
                            return (
                              <li key={m.id}>
                                <label className="flex items-center gap-2 text-sm text-slate-700">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-slate-300"
                                    disabled={already || released}
                                    checked={already || checked}
                                    onChange={() => toggleRefund(d.id, m.id)}
                                  />
                                  <span>
                                    {m.label} · {money(m.amount)} · <Badge status={m.status} />
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                        <p className="text-xs text-slate-400">
                          Tick held or pending milestones to refund them. Money already released can't be refunded.
                          "Favor client" refunds everything not yet released; "Favor professional" releases it.
                        </p>
                      </div>
                    )}
                    <textarea
                      className="input"
                      aria-label="Resolution notes"
                      placeholder="Resolution notes (visible in audit trail)"
                      value={notes[d.id] || ""}
                      onChange={(e) => setNotes({ ...notes, [d.id]: e.target.value })}
                    />
                    <div>
                      <label className="label" htmlFor={`dispute-status-${d.id}`}>After resolution, set job to</label>
                      <select
                        id={`dispute-status-${d.id}`}
                        className="input w-auto"
                        value={jobStatus[d.id] || ""}
                        onChange={(e) =>
                          setJobStatus({ ...jobStatus, [d.id]: e.target.value as "" | "cancelled" | "completed" | "restore" })
                        }
                      >
                        <option value="">Default for outcome</option>
                        <option value="cancelled">Cancelled (refund what's left)</option>
                        <option value="completed">Completed (release what's left)</option>
                        <option value="restore">
                          Back to {d.previousJobStatus ? d.previousJobStatus.replace(/_/g, " ") : "previous status"}
                        </option>
                      </select>
                      <p className="mt-1 text-xs text-slate-400">
                        Defaults: favor client → cancelled · favor professional → completed · no action → back to{" "}
                        {d.previousJobStatus ? d.previousJobStatus.replace(/_/g, " ") : "previous status"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        disabled={busyId === d.id}
                        onClick={() => resolve(d.id, "favor_homeowner")}
                      >
                        Favor client
                      </button>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        disabled={busyId === d.id}
                        onClick={() => resolve(d.id, "favor_tradesperson")}
                      >
                        Favor professional
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={busyId === d.id}
                        onClick={() => resolve(d.id, "no_action")}
                      >
                        No action
                      </button>
                    </div>
                  </>
                )}

                {d.status === "resolved" && (
                  <div className="space-y-1 text-sm text-slate-600">
                    {d.resolutionNotes && (
                      <p className="bg-slate-50 rounded-xl p-3">Notes: {d.resolutionNotes}</p>
                    )}
                    {d.refundMeta && (d.refundMeta.totalRefunded > 0 || (d.refundMeta.totalReleased ?? 0) > 0) && (
                      <p className="bg-emerald-50 text-emerald-900 rounded-xl p-3">
                        {d.refundMeta.totalRefunded > 0 && <>Refunded (simulated): {money(d.refundMeta.totalRefunded)}</>}
                        {d.refundMeta.labels?.length ? ` · ${d.refundMeta.labels.join(", ")}` : ""}
                        {(d.refundMeta.totalReleased ?? 0) > 0 && <> Released to the professional: {money(d.refundMeta.totalReleased)}</>}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}
