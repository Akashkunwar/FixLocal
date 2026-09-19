/** Public URL prefixes. Internal roles stay HOMEOWNER / TRADESPERSON. */
export const CLIENT_ROOT = "/client";
export const PRO_ROOT = "/professional";
export const LEGACY_CLIENT_ROOT = "/homeowner";
export const LEGACY_PRO_ROOT = "/tradesperson";

function join(root: string, sub = ""): string {
  if (!sub) return root;
  return `${root}${sub.startsWith("/") ? sub : `/${sub}`}`;
}

/** Canonical client path (preferred in new links). */
export function clientPath(sub = ""): string {
  return join(CLIENT_ROOT, sub);
}

/** Canonical professional path (preferred in new links). */
export function proPath(sub = ""): string {
  return join(PRO_ROOT, sub);
}

/** Only same-site paths are allowed as a post-login redirect (blocks //evil.com and /\\evil.com). */
export function safeNext(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}

export type SiteType = "residential" | "office";

export const SITE_TYPES: { value: SiteType; label: string; hint: string }[] = [
  { value: "residential", label: "Residential", hint: "Home / apartment" },
  { value: "office", label: "Office / facilities", hint: "Workplace or building" },
];

export function siteTypeLabel(v?: string | null) {
  if (v === "residential") return "Residential";
  if (v === "office") return "Office / facilities";
  return null;
}
