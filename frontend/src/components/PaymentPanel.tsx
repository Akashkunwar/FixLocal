import { useEffect, useState } from "react";
import {
  getJobPayments,
  releaseMilestone,
  type Job,
  type PaymentMilestone,
  type JobPayments,
} from "../api/jobs";
import { Badge } from "./ui/Badge";
import { Spinner } from "./ui/Spinner";
import { money, fmtDate } from "../lib/format";
import { useToast } from "./Toast";
import { Download, IndianRupee, Printer } from "lucide-react";
import { downloadMilestoneInvoice, printMilestoneInvoice } from "../lib/invoice";

export function PaymentPanel({
  job,
  canRelease,
  onChanged,
}: {
  job: Job;
  canRelease: boolean;
  onChanged?: () => void;
}) {
  const { success, error } = useToast();
  const [data, setData] = useState<JobPayments | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await getJobPayments(job.id);
      setData(r);
    } catch (e) {
      error((e as Error).message || "Failed to load payments");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (job.acceptedBidId || job.paymentStatus) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the job's payment state changes; load() reads the current job
  }, [job.id, job.paymentStatus, job.acceptedBidId]);

  async function onRelease(m: PaymentMilestone) {
    if (!confirm(`Release ${m.label} (${money(m.amount)}) from escrow to the pro?`)) return;
    setBusyId(m.id);
    try {
      await releaseMilestone(job.id, m.id);
      success(`${m.label} released`);
      await load();
      onChanged?.();
    } catch (e) {
      error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (!job.acceptedBidId && job.paymentStatus === "pending") {
    return (
      <section className="card p-4 sm:p-5">
        <h2 className="font-semibold flex items-center gap-2">
          <IndianRupee className="h-4 w-4 text-brand-700" /> Simulated escrow
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          Escrow opens when you accept a bid. If the bid has a structured quote, escrow uses the <strong>quote</strong> amount; otherwise the bid amount. Funds are simulated only — no real charges.
        </p>
      </section>
    );
  }

  if (loading || !data) {
    return (
      <section className="card p-4 sm:p-5">
        <Spinner label="Loading escrow…" />
      </section>
    );
  }

  const nextRelease = data.milestones.find(
    (m) => m.status === "held" || m.status === "pending"
  );

  return (
    <section className="card p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <IndianRupee className="h-4 w-4 text-brand-700" /> Simulated escrow
          </h2>
          <p className="mt-1 text-xs text-slate-500">Demo payments only — no Stripe / bank transfer.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge status={data.paymentStatus} />
          {data.escrowSource && (
            <span
              className={
                data.escrowSource === "quote"
                  ? "inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 ring-1 ring-amber-200"
                  : "inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 ring-1 ring-slate-200"
              }
              title={
                data.escrowSource === "quote"
                  ? "Escrow funded from the accepted structured quote"
                  : "Escrow funded from the accepted bid amount"
              }
            >
              From {data.escrowSource}
            </span>
          )}
          {data.milestones.length > 0 && (
            <>
              <button
                type="button"
                className="btn-secondary btn-sm touch-target"
                onClick={() => {
                  if (printMilestoneInvoice(job, data) === "downloaded") {
                    success("Pop-up blocked — the escrow summary was downloaded instead");
                  }
                }}
                title="Print or save as PDF"
              >
                <Printer className="h-3.5 w-3.5" />
                <span className="hidden xs:inline sm:inline">Print</span>
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm touch-target"
                onClick={() => {
                  downloadMilestoneInvoice(job, data);
                  success("Escrow summary downloaded");
                }}
                title="Download HTML summary"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Download</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-slate-50 p-2.5 sm:p-3 ring-1 ring-slate-100">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Escrow</p>
          <p className="mt-1 text-sm sm:text-base font-semibold text-slate-900">
            {money(data.escrowAmount)}
          </p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-2.5 sm:p-3 ring-1 ring-emerald-100">
          <p className="text-[10px] uppercase tracking-wide text-emerald-700/70">Released</p>
          <p className="mt-1 text-sm sm:text-base font-semibold text-emerald-900">
            {money(data.releasedTotal)}
          </p>
        </div>
        <div className="rounded-xl bg-amber-50 p-2.5 sm:p-3 ring-1 ring-amber-100">
          <p className="text-[10px] uppercase tracking-wide text-amber-800/70">Held</p>
          <p className="mt-1 text-sm sm:text-base font-semibold text-amber-950">
            {money(data.remainingHeld)}
          </p>
        </div>
      </div>

      {data.escrowSource && (
        <p className="text-xs text-slate-500">
          Escrow source:{" "}
          <strong className="text-slate-700">
            {data.escrowSource === "quote" ? "structured quote" : "bid amount"}
          </strong>{" "}
          (simulated)
        </p>
      )}

      {(data.parties?.homeowner || data.parties?.tradesperson) && (
        <div className="grid gap-2 sm:grid-cols-2 text-xs text-slate-600">
          <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Client</p>
            <p className="font-medium text-slate-800">
              {data.parties?.homeowner?.name || "—"}
            </p>
            {data.parties?.homeowner?.email && (
              <p className="text-slate-500 truncate">{data.parties.homeowner.email}</p>
            )}
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Professional</p>
            <p className="font-medium text-slate-800">
              {data.parties?.tradesperson?.name || "—"}
            </p>
            {data.parties?.tradesperson?.email && (
              <p className="text-slate-500 truncate">{data.parties.tradesperson.email}</p>
            )}
          </div>
        </div>
      )}

      {data.auditNotes && data.auditNotes.length > 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-600">
          <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Audit notes</p>
          <p className="line-clamp-2">
            {data.auditNotes[0].snippet || data.auditNotes[0].summary}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400">
            Included on printable invoice
            {data.auditNotes.length > 1 ? ` · +${data.auditNotes.length - 1} more` : ""}
          </p>
        </div>
      )}

      <ul className="space-y-2">
        {data.milestones.map((m) => {
          const isNext = nextRelease?.id === m.id;
          return (
            <li
              key={m.id}
              className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-2 rounded-xl border border-slate-200 px-3 py-3"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {m.sequence}. {m.label}{" "}
                  <span className="text-slate-400 font-normal">({m.percent}%)</span>
                </p>
                <p className="text-xs text-slate-500">
                  {money(m.amount)}
                  {m.releasedAt ? ` · released ${fmtDate(m.releasedAt)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 self-stretch sm:self-auto">
                <Badge status={m.status} />
                {canRelease && isNext && m.status !== "released" && m.status !== "refunded" && (
                  <button
                    type="button"
                    className="btn-primary btn-sm flex-1 sm:flex-none touch-target"
                    disabled={busyId === m.id}
                    onClick={() => onRelease(m)}
                  >
                    {busyId === m.id ? "…" : "Release"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
