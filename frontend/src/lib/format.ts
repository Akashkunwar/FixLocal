import { currentLang, t } from "./t";
/** Locale for numbers and dates: Hindi digits stay Latin (hi-IN uses Latin digits by default). */
export function displayLocale() {
  return currentLang() === "hi" ? "hi-IN" : "en-IN";
}

let displayTimeZone = "Asia/Kolkata";
/** Dates show in the user's own time zone (Settings), defaulting to IST. AuthContext sets this. */
export function setDisplayTimeZone(tz?: string | null) {
  try {
    if (tz) new Intl.DateTimeFormat("en-IN", { timeZone: tz }); // throws on an unknown zone
    displayTimeZone = tz || "Asia/Kolkata";
  } catch {
    displayTimeZone = "Asia/Kolkata";
  }
}
export const getDisplayTimeZone = () => displayTimeZone;

export function money(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return new Intl.NumberFormat(displayLocale(), {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Exact amount for payments and invoices: paise are shown when there are any, so milestones add
 * up to the total (₹999 → ₹299.70 + ₹399.60 + ₹299.70, not ₹300 + ₹400 + ₹300).
 */
export function moneyExact(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const whole = Math.abs(n * 100 - Math.round(n) * 100) < 0.5;
  return new Intl.NumberFormat(displayLocale(), {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(n);
}

function toDate(v?: string | Date | number | null): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(v?: string | Date | number | null) {
  const d = toDate(v);
  if (!d) return "—";
  return d.toLocaleDateString(displayLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: displayTimeZone,
  });
}

export function fmtDateTime(v?: string | Date | number | null) {
  const d = toDate(v);
  if (!d) return "—";
  return d.toLocaleString(displayLocale(), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: displayTimeZone,
  });
}

/** Date and time with the year (history entries, audit rows). */
export function fmtDateTimeFull(v?: string | Date | number | null) {
  const d = toDate(v);
  if (!d) return "—";
  return d.toLocaleString(displayLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: displayTimeZone,
  });
}

export function fmtTime(v?: string | Date | number | null) {
  const d = toDate(v);
  if (!d) return "—";
  return d.toLocaleTimeString(displayLocale(), { hour: "2-digit", minute: "2-digit", timeZone: displayTimeZone });
}

export function initials(name?: string | null, email?: string) {
  const s = (name || email || "?").trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

export const CATEGORIES = [
  { value: "plumbing", label: "Plumbing", group: "Home repair & maintenance" },
  { value: "electrical", label: "Electrical", group: "Home repair & maintenance" },
  { value: "carpentry", label: "Carpentry", group: "Home repair & maintenance" },
  { value: "painting", label: "Painting", group: "Home repair & maintenance" },
  { value: "appliance", label: "Appliance", group: "Home repair & maintenance" },
  { value: "cleaning", label: "Cleaning (home & office)", group: "Cleaning" },
  { value: "construction", label: "Construction / skilled trades", group: "Construction" },
  { value: "office_facilities", label: "Office & facilities", group: "Office & facilities" },
  { value: "tech_services", label: "Tech services (CCTV, networking, AMC)", group: "Tech services" },
  { value: "moving", label: "Moving / drivers / helpers", group: "Moving" },
  { value: "other", label: "Other", group: "Other" },
] as const;

export type CategoryValue = (typeof CATEGORIES)[number]["value"];

export function categoryLabel(c: string) {
  const label = CATEGORIES.find((x) => x.value === c)?.label;
  return label ? t(label) : c;
}

/** Ordered [groupName, categories[]] for <optgroup> selects. */
export function categoryGroups() {
  const map = new Map<string, (typeof CATEGORIES)[number][]>();
  for (const c of CATEGORIES) {
    const list = map.get(c.group) || [];
    list.push(c);
    map.set(c.group, list);
  }
  return [...map.entries()];
}

/** User-facing role copy — internal keys stay HOMEOWNER / TRADESPERSON. */
export function roleLabel(role?: string | null) {
  switch ((role || "").toUpperCase()) {
    case "HOMEOWNER":
      return t("Client");
    case "TRADESPERSON":
      return t("Professional");
    case "ADMIN":
      return t("Admin");
    default:
      return role || "—";
  }
}
