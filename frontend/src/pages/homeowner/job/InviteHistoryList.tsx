import { Link } from "react-router-dom";
import type { JobInvite } from "../../../api/jobs";
import { Countdown } from "../../../components/Countdown";
import { fmtDateTime } from "../../../lib/format";

const REASON_LABEL: Record<string, string> = {
  busy: "Busy / fully booked",
  schedule: "Schedule conflict",
  too_far: "Too far",
  rate: "Rate mismatch",
  specialty: "Not my specialty",
  other: "Other",
};

/** Who was invited to a job, what happened, and any re-invite cooldown. */
export function InviteHistoryList({
  invites,
  quota,
  now,
}: {
  invites: JobInvite[];
  quota: { used: number; limit: number; remaining: number } | null;
  now: number;
}) {
  return (
    <>
      <h3 className="text-sm font-semibold text-slate-900">Invite history</h3>
      <p className="text-xs text-slate-500 mb-2">
        Who was invited, when, and pending vs declined
        {quota ? ` · ${quota.used}/${quota.limit} used` : ""}
      </p>
      <ul className="space-y-2">
        {invites.map((inv) => {
          const coolMs =
            inv.inCooldown && inv.cooldownUntil
              ? Math.max(0, new Date(inv.cooldownUntil).getTime() - now)
              : 0;

          return (
            <li
              key={inv.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-900">
                  {inv.tradespersonName || "Pro"}{" "}
                  <span
                    className={
                      inv.status === "declined"
                        ? "text-[10px] uppercase tracking-wide text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded-full"
                        : "text-[10px] uppercase tracking-wide text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded-full"
                    }
                  >
                    {inv.status}
                  </span>
                  {inv.opened && (
                    <span className="ml-1 text-[10px] uppercase tracking-wide text-sky-800 bg-sky-50 px-1.5 py-0.5 rounded-full">
                      opened
                    </span>
                  )}
                  {inv.bidAfterInvite && (
                    <span className="ml-1 text-[10px] uppercase tracking-wide text-violet-800 bg-violet-50 px-1.5 py-0.5 rounded-full">
                      bid
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-slate-500">
                  Invited by {inv.invitedByName || "you"} ·{" "}
                  {fmtDateTime(inv.invitedAt)}
                  {inv.declinedAt
                    ? ` · declined ${fmtDateTime(inv.declinedAt)}`
                    : ""}
                </p>
                {(inv.declineReason || inv.declineNote) && (
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    {[
                      inv.declineReason
                        ? REASON_LABEL[inv.declineReason] || inv.declineReason
                        : null,
                      inv.declineNote,
                    ]
                      .filter(Boolean)
                      .join(" — ")}
                  </p>
                )}
                {coolMs > 0 && (
                  <p className="text-[11px] font-medium text-amber-800 mt-0.5">
                    Re-invite in <Countdown until={inv.cooldownUntil!} />
                  </p>
                )}
              </div>
              <Link
                to={`/pros/${inv.tradespersonId}`}
                className="text-xs text-brand-700 no-underline hover:underline"
              >
                Profile
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
