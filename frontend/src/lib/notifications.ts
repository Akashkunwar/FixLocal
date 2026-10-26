import type { Notification } from "../api/extras";

/** Fired on window when notifications are read elsewhere (the bell reloads its badge). */
export const NOTIFICATIONS_CHANGED = "fixlocal:notifications-changed";

/** Where a notification should take you (some deep-link into the right part of a job page). */
export function notificationHref(n: Notification): string {
  const meta = n.meta || {};
  if (meta.invite === true && typeof meta.jobId === "string") {
    return `/professional/jobs/${meta.jobId}?invite=1#bid-form`;
  }
  if (meta.inviteDeclined === true && typeof meta.jobId === "string") {
    return `/client/jobs/${meta.jobId}`;
  }
  if (
    meta.quoteRevised === true &&
    typeof meta.jobId === "string" &&
    typeof meta.bidId === "string"
  ) {
    return `/client/jobs/${meta.jobId}?bid=${meta.bidId}#bid-${meta.bidId}`;
  }
  if (meta.counterOffer === true && typeof meta.jobId === "string") {
    return `/professional/jobs/${meta.jobId}?counter=1#bid-form`;
  }
  if (meta.quoteViewed === true && typeof meta.jobId === "string") {
    return `/professional/jobs/${meta.jobId}`;
  }
  return n.link || "#";
}

/** Filter groups for the notification centre (each maps to server notification types). */
export const NOTIFICATION_GROUPS: { key: string; label: string; types: string[] }[] = [
  { key: "all", label: "All", types: [] },
  { key: "jobs", label: "Jobs & bids", types: ["new_bid", "bid_accepted", "bid_rejected", "job_status", "match", "job_alert"] },
  { key: "messages", label: "Messages", types: ["message"] },
  { key: "payments", label: "Payments & disputes", types: ["system", "dispute"] },
  { key: "reviews", label: "Reviews", types: ["review"] },
  { key: "pros", label: "Saved pros", types: ["pro_available"] },
];

/** "Today", "Yesterday" or a date, for grouping a feed (in the viewer's time zone). */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
