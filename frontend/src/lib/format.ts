export function money(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function fmtDate(v?: string | Date | null) {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateTime(v?: string | Date | null) {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function initials(name?: string | null, email?: string) {
  const s = (name || email || "?").trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

export const CATEGORIES = [
  { value: "plumbing", label: "Plumbing", emoji: "🔧", group: "Home repair & maintenance" },
  { value: "electrical", label: "Electrical", emoji: "⚡", group: "Home repair & maintenance" },
  { value: "carpentry", label: "Carpentry", emoji: "🪚", group: "Home repair & maintenance" },
  { value: "painting", label: "Painting", emoji: "🎨", group: "Home repair & maintenance" },
  { value: "appliance", label: "Appliance", emoji: "🔌", group: "Home repair & maintenance" },
  { value: "cleaning", label: "Cleaning (home & office)", emoji: "🧹", group: "Cleaning" },
  { value: "construction", label: "Construction / skilled trades", emoji: "🏗️", group: "Construction" },
  { value: "office_facilities", label: "Office & facilities", emoji: "🏢", group: "Office & facilities" },
  { value: "tech_services", label: "Tech services (CCTV, networking, AMC)", emoji: "📡", group: "Tech services" },
  { value: "moving", label: "Moving / drivers / helpers", emoji: "🚚", group: "Moving" },
  { value: "other", label: "Other", emoji: "🛠️", group: "Other" },
] as const;

export type CategoryValue = (typeof CATEGORIES)[number]["value"];

export function categoryLabel(c: string) {
  return CATEGORIES.find((x) => x.value === c)?.label || c;
}

export function categoryEmoji(c: string) {
  return CATEGORIES.find((x) => x.value === c)?.emoji || "🛠️";
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
      return "Client";
    case "TRADESPERSON":
      return "Professional";
    case "ADMIN":
      return "Admin";
    default:
      return role || "—";
  }
}
