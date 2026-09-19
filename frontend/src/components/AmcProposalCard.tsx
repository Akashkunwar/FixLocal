import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  proposeAmc,
  replyAmc,
  requestAmc,
  replyAmcRequest,
  type Job,
} from "../api/jobs";
import {
  CADENCE_OPTIONS,
  cadenceLabel,
  normalizeCadence,
  suggestNextVisitIso,
  type JobCadence,
} from "../lib/jobCadence";
import { money } from "../lib/format";
import {
  formatCustomPackage,
  softRatePackages,
  type CustomRatePackage,
  type SoftRateCard,
} from "../lib/ratePackages";
import {
  downloadAmcReminderIcs,
  downloadAmcMultiEventIcs,
  googleAmcReminderUrl,
  hasAmcMultiEventStub,
} from "../lib/ics";
import { useToast } from "./Toast";
import { Calendar, RefreshCw } from "lucide-react";

const PROPOSE_CADENCES = CADENCE_OPTIONS.filter((o) => o.value !== "one_time");

export type AmcFillPackage = {
  id: string;
  label: string;
  amountMin: number;
  amountMax?: number | null;
  unit?: string | null;
  hint?: string;
  source: "custom" | "soft";
};

export function AmcProposalCard({
  job,
  role,
  onChanged,
  /** Portfolio custom rate packages for one-click fill */
  customRatePackages,
  /** Soft hourly-derived packages (optional; computed from hourly if omitted) */
  softPackages,
  hourlyRateMin,
  hourlyRateMax,
}: {
  job: Job;
  /** "pro" can propose / reply to request; "client" can request / reply to proposal */
  role: "pro" | "client";
  onChanged?: () => void;
  customRatePackages?: CustomRatePackage[] | null;
  softPackages?: SoftRateCard[] | null;
  hourlyRateMin?: string | number | null;
  hourlyRateMax?: string | number | null;
}) {
  const { success, error } = useToast();
  const proposal = job.amcProposal || null;
  const [busy, setBusy] = useState(false);

  const defaultCadence: JobCadence =
    job.cadence && normalizeCadence(job.cadence) !== "one_time"
      ? normalizeCadence(job.cadence)
      : "monthly";

  const [cadence, setCadence] = useState<JobCadence>(defaultCadence);
  const [packageLabel, setPackageLabel] = useState("Monthly maintenance visit");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [unit, setUnit] = useState("visit");
  const [note, setNote] = useState(job.cadenceNote || "");

  const [replyNote, setReplyNote] = useState("");
  const [replyCadence, setReplyCadence] = useState<JobCadence>(defaultCadence);
  const [showCounter, setShowCounter] = useState(false);

  const fillPackages: AmcFillPackage[] = useMemo(() => {
    const custom = (customRatePackages || []).map((p) => ({
      id: `c-${p.id}`,
      label: p.label,
      amountMin: p.amountMin,
      amountMax: p.amountMax,
      unit: p.unit,
      hint: p.hint,
      source: "custom" as const,
    }));
    const softSrc =
      softPackages && softPackages.length
        ? softPackages
        : softRatePackages(hourlyRateMin, hourlyRateMax);
    const soft = softSrc.map((p) => ({
      id: `s-${p.id}`,
      label: p.label,
      amountMin: p.amountMin,
      amountMax: p.amountMax,
      unit: "visit",
      hint: p.hint,
      source: "soft" as const,
    }));
    return [...custom, ...soft].slice(0, 12);
  }, [customRatePackages, softPackages, hourlyRateMin, hourlyRateMax]);

  useEffect(() => {
    if (proposal?.packageLabel) setPackageLabel(proposal.packageLabel);
    if (proposal?.cadence) setCadence(normalizeCadence(proposal.cadence));
    if (proposal?.amountMin != null) setAmountMin(String(proposal.amountMin));
    if (proposal?.amountMax != null) setAmountMax(String(proposal.amountMax));
    if (proposal?.unit) setUnit(proposal.unit);
    if (proposal?.note) setNote(proposal.note);
    // Re-sync the form only when a new proposal arrives, so in-progress edits aren't overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal?.proposedAt]);

  function applyPackage(p: AmcFillPackage) {
    setPackageLabel(p.label);
    setAmountMin(String(p.amountMin));
    setAmountMax(
      p.amountMax != null && Number(p.amountMax) > p.amountMin
        ? String(p.amountMax)
        : ""
    );
    setUnit((p.unit && String(p.unit).trim()) || "visit");
    if (p.hint) {
      setNote((prev) => (prev.trim() ? prev : p.hint || ""));
    }
    success(`Filled from ${p.source === "custom" ? "portfolio" : "soft"} package`);
  }

  async function onPropose(e: FormEvent) {
    e.preventDefault();
    const min = Number(amountMin);
    if (!packageLabel.trim() || !Number.isFinite(min) || min < 0) {
      error("Add a package name and amount");
      return;
    }
    setBusy(true);
    try {
      await proposeAmc(job.id, {
        cadence,
        packageLabel: packageLabel.trim(),
        amountMin: min,
        amountMax: amountMax.trim() ? Number(amountMax) : undefined,
        unit: unit.trim() || undefined,
        note: note.trim() || undefined,
      });
      success("Recurring / AMC proposal sent to client");
      onChanged?.();
    } catch (err) {
      error((err as Error).message || "Could not send proposal");
    } finally {
      setBusy(false);
    }
  }

  async function onRequest(e: FormEvent) {
    e.preventDefault();
    const min = Number(amountMin);
    if (!packageLabel.trim() || !Number.isFinite(min) || min < 0) {
      error("Add a package name and amount");
      return;
    }
    setBusy(true);
    try {
      await requestAmc(job.id, {
        cadence,
        packageLabel: packageLabel.trim(),
        amountMin: min,
        amountMax: amountMax.trim() ? Number(amountMax) : undefined,
        unit: unit.trim() || undefined,
        note: note.trim() || undefined,
      });
      success("AMC / recurring request sent to professional");
      onChanged?.();
    } catch (err) {
      error((err as Error).message || "Could not send request");
    } finally {
      setBusy(false);
    }
  }

  async function onReply(action: "accept" | "decline" | "counter") {
    setBusy(true);
    try {
      await replyAmc(job.id, {
        action,
        replyNote: replyNote.trim() || undefined,
        replyCadence: action === "counter" ? replyCadence : undefined,
      });
      success(
        action === "accept"
          ? "Accepted — soft next-visit hint below; finalize in chat"
          : action === "decline"
            ? "Proposal declined"
            : "Counter cadence sent"
      );
      setShowCounter(false);
      onChanged?.();
    } catch (err) {
      error((err as Error).message || "Reply failed");
    } finally {
      setBusy(false);
    }
  }

  async function onReplyRequest(action: "accept" | "decline" | "counter") {
    setBusy(true);
    try {
      await replyAmcRequest(job.id, {
        action,
        replyNote: replyNote.trim() || undefined,
        replyCadence: action === "counter" ? replyCadence : undefined,
        ...(action !== "decline"
          ? {
              packageLabel: packageLabel.trim() || undefined,
              amountMin: amountMin.trim() ? Number(amountMin) : undefined,
              amountMax: amountMax.trim() ? Number(amountMax) : undefined,
              unit: unit.trim() || undefined,
              cadence,
            }
          : {}),
      });
      success(
        action === "accept"
          ? "Accepted client AMC request — soft next-visit hint below"
          : action === "decline"
            ? "Client AMC request declined"
            : "Counter sent to client"
      );
      setShowCounter(false);
      onChanged?.();
    } catch (err) {
      error((err as Error).message || "Reply failed");
    } finally {
      setBusy(false);
    }
  }

  const status = proposal?.status;
  const showProForm =
    role === "pro" && (!proposal || status === "declined" || status === "countered");
  const showClientRequest =
    role === "client" && (!proposal || status === "declined" || status === "countered");
  const showClientReply = role === "client" && status === "proposed";
  const showProReplyToRequest = role === "pro" && status === "requested";
  const showAcceptedHint = status === "accepted";
  const multiStub = showAcceptedHint && hasAmcMultiEventStub(job);

  const repliedAt = proposal?.repliedAt;
  const proposedAt = proposal?.proposedAt;
  const proposalCadence = proposal?.cadence;
  const hasProposal = Boolean(proposal);
  const nextVisitIso = useMemo(() => {
    if (!showAcceptedHint || !hasProposal) return null;
    const base = repliedAt || proposedAt || new Date().toISOString();
    return suggestNextVisitIso(proposalCadence, base);
  }, [showAcceptedHint, hasProposal, repliedAt, proposedAt, proposalCadence]);

  const nextVisitLabel = nextVisitIso
    ? new Date(nextVisitIso).toLocaleString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  function packageFormFields(idPrefix: string) {
    return (
      <>
        {role === "pro" && fillPackages.length > 0 && (
          <div>
            <p className="label">Fill from portfolio rate packages</p>
            <p className="mb-2 text-xs text-slate-500">
              One-click fill name + amounts from your custom or soft packages.
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Rate packages">
              {fillPackages.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-violet-50 hover:ring-violet-200"
                  title={p.hint || formatCustomPackage(p)}
                  onClick={() => applyPackage(p)}
                >
                  {p.label}
                  <span className="ml-1 text-slate-400">
                    · {money(p.amountMin)}
                    {p.source === "soft" ? " ≈" : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="label" htmlFor={`${idPrefix}-pkg`}>
            Package name
          </label>
          <input
            id={`${idPrefix}-pkg`}
            className="input"
            value={packageLabel}
            onChange={(e) => setPackageLabel(e.target.value)}
            placeholder="e.g. Quarterly AMC check"
            required
          />
        </div>
        <div>
          <p className="label">Cadence</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Proposal cadence">
            {PROPOSE_CADENCES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={
                  cadence === opt.value ? "btn-primary btn-sm" : "btn-secondary btn-sm"
                }
                aria-pressed={cadence === opt.value}
                onClick={() => setCadence(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor={`${idPrefix}-min`}>
              Amount min (₹)
            </label>
            <input
              id={`${idPrefix}-min`}
              className="input"
              type="number"
              min={0}
              value={amountMin}
              onChange={(e) => setAmountMin(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor={`${idPrefix}-max`}>
              Amount max (₹)
            </label>
            <input
              id={`${idPrefix}-max`}
              className="input"
              type="number"
              min={0}
              value={amountMax}
              onChange={(e) => setAmountMax(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor={`${idPrefix}-unit`}>
              Unit
            </label>
            <input
              id={`${idPrefix}-unit`}
              className="input"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="visit / month"
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor={`${idPrefix}-note`}>
            Note (optional)
          </label>
          <textarea
            id={`${idPrefix}-note`}
            className="input"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What’s included, response SLA, materials…"
          />
        </div>
      </>
    );
  }

  return (
    <section className="card p-5 sm:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-violet-50 p-2 text-violet-700 ring-1 ring-violet-100">
          <RefreshCw className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-lg text-slate-900">
            Soft AMC / recurring
          </h2>
          <p className="text-sm text-slate-500">
            {role === "client"
              ? "Request a package + cadence, or reply when your professional proposes. Soft only — no auto-billing."
              : "Propose a package, or reply when the client requests AMC. Soft only — finalize in chat."}
          </p>
        </div>
      </div>

      {proposal && (
        <div
          className={
            status === "accepted"
              ? "rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-100"
              : status === "declined"
                ? "rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200"
                : status === "countered"
                  ? "rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950 ring-1 ring-amber-100"
                  : status === "requested"
                    ? "rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-950 ring-1 ring-sky-100"
                    : "rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-950 ring-1 ring-violet-100"
          }
        >
          <p className="font-semibold">
            {proposal.packageLabel}{" "}
            <span className="font-normal text-xs uppercase tracking-wide opacity-80">
              · {status === "requested" ? "client request" : status}
            </span>
          </p>
          <p className="mt-0.5 text-xs">
            {cadenceLabel(proposal.cadence)} · {money(proposal.amountMin)}
            {proposal.amountMax != null ? ` – ${money(proposal.amountMax)}` : ""}
            {proposal.unit ? ` / ${proposal.unit}` : ""}
          </p>
          {proposal.note && <p className="mt-1 text-xs opacity-90">{proposal.note}</p>}
          {proposal.replyNote && (
            <p className="mt-1 text-xs">
              <span className="font-semibold">
                {status === "requested" ? "Note:" : "Reply:"}
              </span>{" "}
              {proposal.replyNote}
              {proposal.replyCadence
                ? ` · preferred ${cadenceLabel(proposal.replyCadence)}`
                : ""}
            </p>
          )}
        </div>
      )}

      {showAcceptedHint && nextVisitIso && (
        <div className="space-y-2 rounded-xl bg-sky-50 p-4 ring-1 ring-sky-100">
          <div className="flex items-start gap-2">
            <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-sky-950">Soft next-visit reminder</p>
              <p className="text-xs text-sky-800/90">
                Suggested around <span className="font-medium">{nextVisitLabel}</span> based on{" "}
                {cadenceLabel(proposal?.cadence)} cadence. Hint only — confirm the real window in chat.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() =>
                downloadAmcReminderIcs(job, nextVisitIso, {
                  packageLabel: proposal?.packageLabel,
                  cadence: proposal?.cadence,
                })
              }
            >
              Add to calendar (.ics)
            </button>
            <a
              className="btn-ghost btn-sm no-underline"
              href={googleAmcReminderUrl(job, nextVisitIso)}
              target="_blank"
              rel="noreferrer"
            >
              Google Calendar
            </a>
            {multiStub && nextVisitIso && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() =>
                  downloadAmcMultiEventIcs(job, nextVisitIso, {
                    packageLabel: proposal?.packageLabel,
                    cadence: proposal?.cadence,
                  })
                }
                title="Includes confirmed visit (if scheduled) + soft AMC next-visit hint"
              >
                Multi-event .ics stub
              </button>
            )}
          </div>
        </div>
      )}

      {showProForm && (
        <form onSubmit={onPropose} className="space-y-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {proposal ? "Send updated proposal" : "Propose to client"}
          </p>
          {packageFormFields("amc")}
          <button type="submit" className="btn-primary btn-sm" disabled={busy}>
            {busy ? "Sending…" : "Send proposal"}
          </button>
        </form>
      )}

      {showClientRequest && (
        <form
          onSubmit={onRequest}
          className="space-y-3 rounded-xl bg-sky-50/60 p-4 ring-1 ring-sky-100"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700/80">
            {proposal ? "Send updated AMC request" : "Request AMC from professional"}
          </p>
          <p className="text-xs text-slate-600">
            Inverse of a pro proposal — ask for a recurring package. Soft only; they can accept,
            decline, or counter.
          </p>
          {packageFormFields("amc-req")}
          <button type="submit" className="btn-primary btn-sm" disabled={busy}>
            {busy ? "Sending…" : "Request AMC"}
          </button>
        </form>
      )}

      {role === "client" && status === "requested" && (
        <p className="text-xs text-slate-500">
          Waiting for your professional to reply to this AMC request.
        </p>
      )}

      {role === "pro" && status === "proposed" && (
        <p className="text-xs text-slate-500">
          Waiting for the client to reply to your proposal.
        </p>
      )}

      {showProReplyToRequest && (
        <div className="space-y-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <p className="text-xs text-slate-600">
            Client requested AMC — soft reply. You can refine package amounts before accepting.
          </p>
          {fillPackages.length > 0 && (
            <div>
              <p className="label">Fill from portfolio rate packages</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Rate packages">
                {fillPackages.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-violet-50 hover:ring-violet-200"
                    onClick={() => applyPackage(p)}
                  >
                    {p.label}
                    <span className="ml-1 text-slate-400">· {money(p.amountMin)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="amc-pro-min">
                Amount min (₹)
              </label>
              <input
                id="amc-pro-min"
                className="input"
                type="number"
                min={0}
                value={amountMin}
                onChange={(e) => setAmountMin(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="amc-pro-max">
                Amount max (₹)
              </label>
              <input
                id="amc-pro-max"
                className="input"
                type="number"
                min={0}
                value={amountMax}
                onChange={(e) => setAmountMax(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="amc-pro-unit">
                Unit
              </label>
              <input
                id="amc-pro-unit"
                className="input"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={busy}
              onClick={() => onReplyRequest("accept")}
            >
              Accept request
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={busy}
              onClick={() => setShowCounter((v) => !v)}
            >
              Counter cadence
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={busy}
              onClick={() => onReplyRequest("decline")}
            >
              Decline
            </button>
          </div>
          <div className="space-y-2">
            <label className="label" htmlFor="amc-pro-reply-note">
              Reply note (optional)
            </label>
            <textarea
              id="amc-pro-reply-note"
              className="input"
              rows={2}
              value={replyNote}
              onChange={(e) => setReplyNote(e.target.value)}
              placeholder="e.g. Can do monthly at this range"
            />
          </div>
          {showCounter && (
            <div className="space-y-2">
              <p className="label">Preferred cadence</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Counter cadence">
                {PROPOSE_CADENCES.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={
                      replyCadence === opt.value
                        ? "btn-primary btn-sm"
                        : "btn-secondary btn-sm"
                    }
                    aria-pressed={replyCadence === opt.value}
                    onClick={() => setReplyCadence(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={busy}
                onClick={() => onReplyRequest("counter")}
              >
                Send counter
              </button>
            </div>
          )}
        </div>
      )}

      {showClientReply && (
        <div className="space-y-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <p className="text-xs text-slate-600">
            Soft reply — accepting doesn’t charge you; confirm scope in chat.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={busy}
              onClick={() => onReply("accept")}
            >
              Accept interest
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={busy}
              onClick={() => setShowCounter((v) => !v)}
            >
              Counter cadence
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={busy}
              onClick={() => onReply("decline")}
            >
              Decline
            </button>
          </div>
          <div className="space-y-2">
            <label className="label" htmlFor="amc-reply-note">
              Reply note (optional)
            </label>
            <textarea
              id="amc-reply-note"
              className="input"
              rows={2}
              value={replyNote}
              onChange={(e) => setReplyNote(e.target.value)}
              placeholder="e.g. Prefer monthly over AMC for now"
            />
          </div>
          {showCounter && (
            <div className="space-y-2">
              <p className="label">Preferred cadence</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Counter cadence">
                {PROPOSE_CADENCES.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={
                      replyCadence === opt.value
                        ? "btn-primary btn-sm"
                        : "btn-secondary btn-sm"
                    }
                    aria-pressed={replyCadence === opt.value}
                    onClick={() => setReplyCadence(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={busy}
                onClick={() => onReply("counter")}
              >
                Send counter
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

