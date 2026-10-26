import type { SpendingJob } from "../api/features";
import { categoryLabel } from "./format";
import { statusLabel } from "./status";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // Quote anything with separators, and neutralise spreadsheet formulas (=, +, -, @).
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Job history as CSV (opens in Excel / Google Sheets; amounts in ₹). */
export function spendingCsv(jobs: SpendingJob[]): string {
  const head = ["Posted", "Job", "Category", "Status", "Professional", "Agreed (INR)", "Paid (INR)", "In escrow (INR)", "Refunded (INR)", "Completed"];
  const rows = jobs.map((j) => [
    j.createdAt.slice(0, 10),
    j.title,
    categoryLabel(j.category),
    statusLabel(j.status),
    j.pro?.name ?? "",
    j.agreedAmount ?? "",
    j.paid,
    j.inEscrow,
    j.refunded,
    j.completedAt ? j.completedAt.slice(0, 10) : "",
  ]);
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** "2026-10" → "Oct 2026" */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
}
