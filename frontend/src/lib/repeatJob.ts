/** Prefill post-job wizard from a completed (or past) job — soft repeat. */
import { CATEGORIES } from "./format";
import { normalizeCadence, type JobCadence } from "./jobCadence";
import type { SiteType } from "./paths";

export const JOB_DRAFT_KEY = "fixlocal_job_draft_v3";
export const REPEAT_BANNER_KEY = "fixlocal_repeat_banner_v1";

export type RepeatableJobLike = {
  id: string;
  title?: string | null;
  description?: string | null;
  category?: string | null;
  siteType?: string | null;
  cadence?: string | null;
  cadenceNote?: string | null;
  maxBids?: number | null;
  budgetMin?: string | number | null;
  budgetMax?: string | number | null;
  address?: string | null;
  city?: string | null;
  area?: string | null;
  pincode?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export type JobDraftPrefill = {
  title: string;
  description: string;
  leadGroup: string;
  category: string;
  siteType: SiteType | "";
  cadence: JobCadence;
  cadenceNote: string;
  maxBids: string;
  budgetMin: string;
  budgetMax: string;
  address: string;
  city: string;
  area: string;
  pincode: string;
  preferredStart: string;
  lat: string;
  lng: string;
};

function str(v: unknown) {
  return v == null ? "" : String(v);
}

/** Build a draft blob + remember which job we repeated for a soft banner. */
export function buildRepeatDraft(job: RepeatableJobLike): JobDraftPrefill {
  const category = str(job.category) || "other";
  const cat = CATEGORIES.find((c) => c.value === category);
  const site =
    job.siteType === "office" || job.siteType === "residential"
      ? job.siteType
      : "";
  const titleBase = str(job.title).trim();
  const title = titleBase
    ? titleBase.replace(/\s*\(repeat\)\s*$/i, "").trim() + " (repeat)"
    : "Repeat job";

  return {
    title: title.slice(0, 120),
    description: str(job.description),
    leadGroup: cat?.group || CATEGORIES[0]?.group || "Other",
    category,
    siteType: site,
    cadence: normalizeCadence(job.cadence),
    cadenceNote: str(job.cadenceNote),
    maxBids: str(job.maxBids || 5) || "5",
    budgetMin: job.budgetMin != null && job.budgetMin !== "" ? str(job.budgetMin) : "",
    budgetMax: job.budgetMax != null && job.budgetMax !== "" ? str(job.budgetMax) : "",
    address: str(job.address),
    city: str(job.city) || "Bengaluru",
    area: str(job.area),
    pincode: str(job.pincode),
    preferredStart: "",
    lat: job.lat != null ? String(job.lat) : "",
    lng: job.lng != null ? String(job.lng) : "",
  };
}

export function saveRepeatDraft(job: RepeatableJobLike) {
  const draft = buildRepeatDraft(job);
  try {
    localStorage.setItem(JOB_DRAFT_KEY, JSON.stringify(draft));
    localStorage.setItem(
      REPEAT_BANNER_KEY,
      JSON.stringify({
        fromJobId: job.id,
        title: job.title || draft.title,
        at: Date.now(),
      })
    );
  } catch {
    /* ignore quota */
  }
  return draft;
}

export function peekRepeatBanner(): { fromJobId: string; title: string } | null {
  try {
    const raw = localStorage.getItem(REPEAT_BANNER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.fromJobId) return null;
    return { fromJobId: String(parsed.fromJobId), title: String(parsed.title || "") };
  } catch {
    return null;
  }
}

export function clearRepeatBanner() {
  try {
    localStorage.removeItem(REPEAT_BANNER_KEY);
  } catch {
    /* ignore */
  }
}
