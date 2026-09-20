/** Soft recurring / AMC cadence on post-job (store only). */

export type JobCadence = "one_time" | "weekly" | "monthly" | "amc";

export const CADENCE_OPTIONS: {
  value: JobCadence;
  label: string;
  hint: string;
}[] = [
  {
    value: "one_time",
    label: "One-time",
    hint: "Single visit or project — default.",
  },
  {
    value: "weekly",
    label: "Weekly",
    hint: "Soft preference for weekly visits (e.g. cleaning).",
  },
  {
    value: "monthly",
    label: "Monthly",
    hint: "Soft preference for monthly check-ins.",
  },
  {
    value: "amc",
    label: "AMC",
    hint: "Annual maintenance contract interest — negotiate in chat.",
  },
];

export function cadenceLabel(raw?: string | null): string {
  const v = String(raw || "one_time").toLowerCase();
  return CADENCE_OPTIONS.find((o) => o.value === v)?.label || "One-time";
}

export function normalizeCadence(raw?: string | null): JobCadence {
  const v = String(raw || "one_time").toLowerCase();
  if (v === "weekly" || v === "monthly" || v === "amc") return v;
  return "one_time";
}

/** Soft days until a suggested next visit after AMC accept (hint only). */
export function cadenceNextVisitDays(raw?: string | null): number {
  const v = normalizeCadence(raw);
  if (v === "weekly") return 7;
  if (v === "monthly") return 30;
  if (v === "amc") return 90; // soft quarterly check-in under annual care
  return 30;
}

/** Suggested next visit ISO start from a base date + cadence. */
export function suggestNextVisitIso(
  cadence?: string | null,
  from: Date | string = new Date(),
  hourLocal = 10
): string {
  const base = typeof from === "string" ? new Date(from) : new Date(from.getTime());
  const days = cadenceNextVisitDays(cadence);
  const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  // Soft local mid-morning feel via UTC offset-agnostic: set hours on the Date object
  next.setHours(hourLocal, 0, 0, 0);
  return next.toISOString();
}
