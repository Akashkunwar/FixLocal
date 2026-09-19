/** Named client job templates library — saved from completed jobs, stored on the account. */
import { CATEGORIES } from "./format";
import { normalizeCadence, type JobCadence } from "./jobCadence";
import type { SiteType } from "./paths";
import type { RepeatableJobLike, JobDraftPrefill } from "./repeatJob";
import { buildRepeatDraft } from "./repeatJob";

export type NamedJobTemplate = {
  id: string;
  name: string;
  title: string;
  description: string;
  category: string;
  siteType?: SiteType | "";
  cadence?: JobCadence;
  cadenceNote?: string;
  budgetMin?: string;
  budgetMax?: string;
  address?: string;
  city?: string;
  area?: string;
  pincode?: string;
  lat?: string;
  lng?: string;
  sourceJobId?: string;
  /** Soft pin — show favorites first in the post-job library. */
  pinned?: boolean;
  createdAt: string;
};

function str(v: unknown) {
  return v == null ? "" : String(v);
}

export function newNamedJobTemplateId() {
  return `njt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeNamedJobTemplates(raw: unknown): NamedJobTemplate[] {
  if (!Array.isArray(raw)) return [];
  const out: NamedJobTemplate[] = [];
  for (let i = 0; i < raw.length && out.length < 24; i++) {
    const t: any = raw[i];
    const name = String(t?.name || t?.label || "").trim().slice(0, 80);
    const title = String(t?.title || "").trim().slice(0, 120);
    if (!name || !title) continue;
    const category = String(t?.category || "other").trim().slice(0, 40) || "other";
    const site =
      t?.siteType === "office" || t?.siteType === "residential" ? t.siteType : "";
    out.push({
      id: String(t?.id || `njt-${i}`).slice(0, 64),
      name,
      title,
      description: String(t?.description || "").trim().slice(0, 4000),
      category,
      siteType: site,
      cadence: normalizeCadence(t?.cadence),
      cadenceNote: str(t?.cadenceNote).slice(0, 500),
      budgetMin: t?.budgetMin != null && t.budgetMin !== "" ? str(t.budgetMin) : "",
      budgetMax: t?.budgetMax != null && t.budgetMax !== "" ? str(t.budgetMax) : "",
      address: str(t?.address).slice(0, 200),
      city: str(t?.city).slice(0, 80),
      area: str(t?.area).slice(0, 80),
      pincode: str(t?.pincode).slice(0, 20),
      lat: t?.lat != null && t.lat !== "" ? str(t.lat) : "",
      lng: t?.lng != null && t.lng !== "" ? str(t.lng) : "",
      ...(t?.sourceJobId ? { sourceJobId: String(t.sourceJobId).slice(0, 64) } : {}),
      ...(t?.pinned ? { pinned: true } : {}),
      createdAt: String(t?.createdAt || new Date().toISOString()),
    });
  }
  return out;
}

/** The account's saved library (normalized). */
export function mergeNamedJobTemplates(fromUser?: unknown): NamedJobTemplate[] {
  return normalizeNamedJobTemplates(fromUser);
}

export function namedTemplateFromJob(
  job: RepeatableJobLike,
  name?: string
): NamedJobTemplate {
  const draft = buildRepeatDraft(job);
  // Strip the "(repeat)" suffix for library entries — user names the template.
  const title = draft.title.replace(/\s*\(repeat\)\s*$/i, "").trim() || "Saved job";
  const defaultName =
    (name && name.trim()) ||
    (job.title ? String(job.title).trim().slice(0, 80) : title.slice(0, 80)) ||
    "My job template";
  return {
    id: newNamedJobTemplateId(),
    name: defaultName.slice(0, 80),
    title: title.slice(0, 120),
    description: draft.description,
    category: draft.category,
    siteType: draft.siteType,
    cadence: draft.cadence,
    cadenceNote: draft.cadenceNote,
    budgetMin: draft.budgetMin,
    budgetMax: draft.budgetMax,
    address: draft.address,
    city: draft.city,
    area: draft.area,
    pincode: draft.pincode,
    lat: draft.lat,
    lng: draft.lng,
    sourceJobId: job.id,
    createdAt: new Date().toISOString(),
  };
}

/** Pure helpers — persist the result with updateProfile({ namedJobTemplates }). */
export function upsertNamedJobTemplate(list: NamedJobTemplate[], entry: NamedJobTemplate): NamedJobTemplate[] {
  const normalized = normalizeNamedJobTemplates([entry])[0];
  if (!normalized) return list;
  return [normalized, ...list.filter((t) => t.id !== normalized.id)].slice(0, 24);
}

export function deleteNamedJobTemplate(list: NamedJobTemplate[], id: string): NamedJobTemplate[] {
  return list.filter((t) => t.id !== id);
}

/** Apply a named template into the post-job draft shape (no "(repeat)" suffix). */
export function draftFromNamedTemplate(t: NamedJobTemplate): JobDraftPrefill {
  const cat = CATEGORIES.find((c) => c.value === t.category);
  return {
    title: t.title,
    description: t.description || "",
    leadGroup: cat?.group || CATEGORIES[0]?.group || "Other",
    category: t.category || "other",
    siteType: t.siteType === "office" || t.siteType === "residential" ? t.siteType : "",
    cadence: normalizeCadence(t.cadence),
    cadenceNote: t.cadenceNote || "",
    maxBids: "5",
    budgetMin: t.budgetMin || "",
    budgetMax: t.budgetMax || "",
    address: t.address || "",
    city: t.city || "Bengaluru",
    area: t.area || "",
    pincode: t.pincode || "",
    preferredStart: "",
    lat: t.lat || "",
    lng: t.lng || "",
  };
}

/** Search / filter named templates by name/title text and specialty (category). */
export function filterNamedJobTemplates(
  list: NamedJobTemplate[],
  opts?: { q?: string; category?: string | null }
): NamedJobTemplate[] {
  const q = (opts?.q || "").trim().toLowerCase();
  const cat = (opts?.category || "").trim();
  const filtered = list.filter((t) => {
    if (cat && cat !== "all" && t.category !== cat) return false;
    if (!q) return true;
    const hay = `${t.name} ${t.title} ${t.description} ${t.category}`.toLowerCase();
    return hay.includes(q);
  });
  // Pinned favorites first, then newest createdAt
  return filtered.slice().sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
}

/** Toggle the pin favorite on one template. */
export function toggleNamedJobTemplatePin(list: NamedJobTemplate[], id: string): NamedJobTemplate[] {
  return list.map((t) => {
    if (t.id !== id) return t;
    if (!t.pinned) return { ...t, pinned: true };
    const copy: NamedJobTemplate = { ...t };
    delete copy.pinned;
    return copy;
  });
}

/** Distinct specialty values present in a named-template library (for filter chips). */
export function namedTemplateSpecialtyOptions(
  list: NamedJobTemplate[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of list) {
    const c = (t.category || "").trim();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
