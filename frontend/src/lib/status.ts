export function statusClass(status: string) {
  const map: Record<string, string> = {
    open: "bg-teal-50 text-teal-800 ring-1 ring-teal-200",
    bidding_closed: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
    awarded: "bg-blue-50 text-blue-800 ring-1 ring-blue-200",
    in_progress: "bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200",
    completed: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
    cancelled: "bg-rose-50 text-rose-800 ring-1 ring-rose-200",
    disputed: "bg-amber-50 text-amber-900 ring-1 ring-amber-200",
    active: "bg-teal-50 text-teal-800 ring-1 ring-teal-200",
    withdrawn: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    rejected: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
    accepted: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
    pending: "bg-amber-50 text-amber-900 ring-1 ring-amber-200",
    verified: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
    suspended: "bg-rose-50 text-rose-800 ring-1 ring-rose-200",
    homeowner: "bg-sky-50 text-sky-800 ring-1 ring-sky-200",
    tradesperson: "bg-violet-50 text-violet-800 ring-1 ring-violet-200",
    admin: "bg-slate-800 text-white ring-1 ring-slate-800",
    favor_homeowner: "bg-sky-50 text-sky-800 ring-1 ring-sky-200",
    favor_tradesperson: "bg-violet-50 text-violet-800 ring-1 ring-violet-200",
    no_action: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
    held: "bg-amber-50 text-amber-900 ring-1 ring-amber-200",
    partially_released: "bg-sky-50 text-sky-800 ring-1 ring-sky-200",
    released: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
    refunded: "bg-rose-50 text-rose-800 ring-1 ring-rose-200",
    simulated_paid: "bg-amber-50 text-amber-900 ring-1 ring-amber-200",
    proposed: "bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200",
    confirmed: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
    none: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    user_suspend: "bg-rose-50 text-rose-800 ring-1 ring-rose-200",
    user_unsuspend: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
    dispute_resolve: "bg-amber-50 text-amber-900 ring-1 ring-amber-200",
    force_cancel: "bg-rose-50 text-rose-800 ring-1 ring-rose-200",
    verify_tradesperson: "bg-sky-50 text-sky-800 ring-1 ring-sky-200",
  };
  return map[status] || "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
}

export const JOB_TIMELINE = ["open", "awarded", "in_progress", "completed"] as const;

export function timelineIndex(status: string) {
  if (status === "cancelled" || status === "disputed") return -1;
  return JOB_TIMELINE.indexOf(status as (typeof JOB_TIMELINE)[number]);
}

export function statusLabel(status: string) {
  const labels: Record<string, string> = {
    homeowner: "Client",
    tradesperson: "Professional",
    favor_homeowner: "Favor client",
    favor_tradesperson: "Favor professional",
    verify_tradesperson: "Verify professional",
    HOMEOWNER: "Client",
    TRADESPERSON: "Professional",
    ADMIN: "Admin",
  };
  if (labels[status]) return labels[status];
  return status.replace(/_/g, " ");
}
