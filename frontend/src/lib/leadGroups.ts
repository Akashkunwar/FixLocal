import { CATEGORIES } from "./format";

/** Lead groups featured on landing + hub pages (excludes "Other"). */
export const LEAD_GROUPS = [
  "Home repair & maintenance",
  "Cleaning",
  "Construction",
  "Office & facilities",
  "Tech services",
  "Moving",
] as const;

export type LeadGroupName = (typeof LEAD_GROUPS)[number];

const GROUP_BLURBS: Record<string, string> = {
  "Home repair & maintenance":
    "Plumbing, electrical, carpentry, painting, and appliance work for homes and apartments.",
  Cleaning: "Home and office cleaning — one-off deep cleans or recurring facilities support.",
  Construction: "Skilled trades and construction help for renovations, fit-outs, and build work.",
  "Office & facilities": "Workplace and building services — facilities, maintenance, and office support.",
  "Tech services": "CCTV, networking, AMC, and on-site tech installs or troubleshooting.",
  Moving: "Movers, drivers, and helpers for residential or office shifts.",
};

export function leadGroupSlug(group: string): string {
  return group
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function leadGroupFromSlug(slug: string): LeadGroupName | null {
  const s = decodeURIComponent(slug || "").trim().toLowerCase();
  for (const g of LEAD_GROUPS) {
    if (leadGroupSlug(g) === s) return g;
  }
  return null;
}

export function categoriesForLeadGroup(group: string) {
  return CATEGORIES.filter((c) => c.group === group);
}

export function leadGroupBlurb(group: string) {
  return GROUP_BLURBS[group] || "Browse specialties in this category group.";
}

export function leadGroupHubPath(group: string) {
  return `/categories/${leadGroupSlug(group)}`;
}
