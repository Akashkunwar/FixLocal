/** Calendar helpers that work in the user's time zone (the server may run in UTC). */

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

// Building an Intl.DateTimeFormat is expensive (~50µs); list pages call these helpers
// thousands of times per request, so keep one formatter per zone.
const formatters = new Map<string, Intl.DateTimeFormat>();
const zoneValidity = new Map<string, boolean>();

function formatterFor(timeZone: string) {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

function parts(date: Date, timeZone: string) {
  const out: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(date)) out[p.type] = p.value;
  return out;
}

function safeZone(tz?: string | null) {
  const zone = tz || DEFAULT_TIMEZONE;
  let valid = zoneValidity.get(zone);
  if (valid === undefined) {
    try {
      formatterFor(zone);
      valid = true;
    } catch {
      valid = false;
    }
    // Only remember a bounded number of distinct inputs (time zones are a small, fixed set).
    if (zoneValidity.size < 1000) zoneValidity.set(zone, valid);
  }
  return valid ? zone : DEFAULT_TIMEZONE;
}

/** YYYY-MM-DD for the given instant in the zone. */
export function localDate(date: Date, tz?: string | null): string {
  const p = parts(date, safeZone(tz));
  return `${p.year}-${p.month}-${p.day}`;
}

export function dayKeyInZone(date: Date, tz?: string | null): DayKey {
  const p = parts(date, safeZone(tz));
  const map: Record<string, DayKey> = {
    Sun: "sun",
    Mon: "mon",
    Tue: "tue",
    Wed: "wed",
    Thu: "thu",
    Fri: "fri",
    Sat: "sat",
  };
  return map[p.weekday] ?? "mon";
}

export function monthKeyInZone(date: Date, tz?: string | null): string {
  const p = parts(date, safeZone(tz));
  return `${p.year}-${p.month}`;
}

/** Today and the following days (local calendar), e.g. for a 7-day availability strip. */
export function localDatesAhead(days: number, tz?: string | null, now = new Date()) {
  const zone = safeZone(tz);
  const out: { date: string; dayKey: DayKey }[] = [];
  const seen = new Set<string>();
  // Step in 12h increments from "now" so DST and zone offsets never skip a calendar day.
  for (let i = 0; out.length < days && i < days * 3; i++) {
    const instant = new Date(now.getTime() + i * 12 * 3600_000);
    const date = localDate(instant, zone);
    if (seen.has(date)) continue;
    seen.add(date);
    out.push({ date, dayKey: dayKeyInZone(instant, zone) });
  }
  return out;
}
