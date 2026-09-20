export type NotifPrefKey =
  | "new_bid"
  | "bid_accepted"
  | "bid_rejected"
  | "job_status"
  | "dispute"
  | "message"
  | "review"
  | "system"
  | "pro_available"
  | "match";

export const NOTIF_PREF_META: { key: NotifPrefKey; label: string; hint: string }[] = [
  { key: "new_bid", label: "New bids", hint: "When someone bids on your job" },
  { key: "bid_accepted", label: "Bid accepted", hint: "When your bid wins" },
  { key: "bid_rejected", label: "Bid updates", hint: "When a competing bid is chosen" },
  { key: "job_status", label: "Job status", hint: "Start, complete, schedule changes" },
  { key: "message", label: "Messages", hint: "New in-job chat messages" },
  { key: "dispute", label: "Disputes", hint: "Dispute opened or resolved" },
  { key: "review", label: "Reviews", hint: "New ratings on your work" },
  { key: "system", label: "System / payments", hint: "Escrow releases and account notices" },
  { key: "pro_available", label: "Saved pro availability", hint: "When a favorited pro updates availability or is verified" },
  { key: "match", label: "Match tips", hint: "Favorite-pro fit, job invites, and similar-job alerts" },
];

export const DEFAULT_NOTIF_PREFS: Record<NotifPrefKey, boolean> = {
  new_bid: true,
  bid_accepted: true,
  bid_rejected: true,
  job_status: true,
  dispute: true,
  message: true,
  review: true,
  system: true,
  pro_available: true,
  match: true,
};

/** Account preferences on top of the defaults (the server is the only store). */
export function mergeNotifPrefs(server?: Partial<Record<string, boolean>> | null): Record<NotifPrefKey, boolean> {
  const out = { ...DEFAULT_NOTIF_PREFS };
  for (const key of Object.keys(out) as NotifPrefKey[]) {
    if (typeof server?.[key] === "boolean") out[key] = server[key] as boolean;
  }
  return out;
}
