import { JobCategory } from "../entities/Job";

/** Single source of truth for category keywords (skills matching, shortlist tags, alerts). */
export const CATEGORY_ALIASES: Record<JobCategory, string[]> = {
  plumbing: ["plumbing", "plumber", "leak", "pipe", "pipes", "bathroom", "kitchen", "fitting", "tap", "taps", "drain", "sanitary"],
  electrical: ["electrical", "electrician", "wiring", "fan", "fans", "light", "lights", "socket", "switch", "inverter"],
  carpentry: ["carpentry", "carpenter", "wood", "woodwork", "furniture", "door", "doors", "cabinet", "cabinets"],
  painting: ["painting", "painter", "paint", "waterproofing", "texture", "wall", "walls"],
  appliance: ["appliance", "appliances", "ac", "fridge", "refrigerator", "washing machine", "microwave", "geyser"],
  cleaning: ["cleaning", "cleaner", "housekeeping", "janitor", "sanitation", "deep clean", "deep cleaning"],
  construction: ["construction", "mason", "masonry", "tiling", "tiles", "welding", "welder", "fabricator", "civil", "skilled trade"],
  office_facilities: ["office", "facilities", "facility management", "pantry", "receptionist", "maintenance"],
  tech_services: ["cctv", "networking", "network", "amc", "it support", "wifi", "camera", "cameras", "server"],
  moving: ["moving", "mover", "movers", "driver", "drivers", "helper", "helpers", "packing", "relocation"],
  other: ["handyman", "general", "repair", "repairs", "maintenance"],
};

/** Short aliases that are real words in this domain even under the 3-letter minimum. */
const SHORT_ALLOWED = new Set(["ac"]);

export function normalizeText(s: string | null | undefined): string {
  return ` ${String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/** Whole-word / whole-phrase match (no substring hits such as "ac" in "facility"). */
export function containsPhrase(haystackNormalized: string, phrase: string): boolean {
  const p = normalizeText(phrase).trim();
  if (!p) return false;
  if (p.length < 3 && !SHORT_ALLOWED.has(p)) return false;
  return haystackNormalized.includes(` ${p} `);
}

export function categoryKeywords(category: string | null | undefined): string[] {
  const key = String(category || "").toLowerCase() as JobCategory;
  const aliases = CATEGORY_ALIASES[key];
  if (aliases) return [key.replace(/_/g, " "), ...aliases];
  return key ? [key] : [];
}

export function matchingKeywords(category: string | null | undefined, text: string | null | undefined): string[] {
  const hay = normalizeText(text);
  const hits: string[] = [];
  for (const kw of categoryKeywords(category)) {
    if (containsPhrase(hay, kw) && !hits.includes(kw)) hits.push(kw);
  }
  return hits;
}

export function textMatchesCategory(text: string | null | undefined, category: string): boolean {
  return matchingKeywords(category, text).length > 0;
}

/** Shortlist tags: a tag matches if it contains a category keyword, or is itself a word of one. */
export function tagMatchesCategory(tag: string, category: string): boolean {
  const t = normalizeText(tag);
  if (t.trim().length < 2) return false;
  for (const kw of categoryKeywords(category)) {
    if (containsPhrase(t, kw)) return true;
    if (t.trim().length >= 3 && containsPhrase(normalizeText(kw), t.trim())) return true;
  }
  return false;
}
