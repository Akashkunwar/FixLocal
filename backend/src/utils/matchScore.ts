import { haversineKm } from "./geo";
import { categoryKeywords, matchingKeywords } from "../domain/categories";
import {
  DEFAULT_MATCH_WEIGHTS,
  type MatchWeights,
} from "./matchWeights";

export type ScoreableJob = {
  category?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export type ScoreablePro = {
  userId: string;
  skills?: string | null;
  city?: string | null;
  serviceAreas?: string | null;
  lat?: number | null;
  lng?: number | null;
  averageRating?: number | null;
  reviewCount?: number | null;
  /** Average hours from job post → first bid (historical). Null = unknown. */
  avgResponseHours?: number | null;
  name?: string | null;
};

export type MatchScoreBreakdown = {
  skills: number;
  rating: number;
  response: number;
  distance: number;
  total: number;
  skillHits: string[];
  distanceKm: number | null;
  avgResponseHours: number | null;
  /** Max points used for this score (admin-tunable). */
  weights?: MatchWeights;
};

/** Skill overlap on a 0–1 scale (whole-word keyword matches), then scaled by weight. */
export function skillOverlapScore(
  category: string | null | undefined,
  skills: string | null | undefined,
  weight = DEFAULT_MATCH_WEIGHTS.skills
): { score: number; hits: string[] } {
  const cat = (category || "").toLowerCase().trim();
  if (!cat || !skills) return { score: 0, hits: [] };
  const hits = matchingKeywords(cat, skills);
  if (hits.length === 0) return { score: 0, hits: [] };
  const primary = categoryKeywords(cat).slice(0, 3);
  const strong = hits.some((h) => primary.includes(h));
  // Fraction of weight (mirrors the original 35-point curve)
  const frac = strong
    ? Math.min(1, (22 + Math.min(hits.length, 4) * 3) / 35)
    : Math.min(1, (8 + hits.length * 4) / 35);
  const score = Math.round(frac * weight * 10) / 10;
  return { score, hits };
}

export function ratingScore(
  averageRating?: number | null,
  reviewCount?: number | null,
  weight = DEFAULT_MATCH_WEIGHTS.rating
): number {
  const r = Number(averageRating) || 0;
  const n = Number(reviewCount) || 0;
  if (r <= 0) {
    // neutral-ish when unrated — scaled from prior 5/8 of 25
    return Math.round(((n > 0 ? 5 : 8) / 25) * weight * 10) / 10;
  }
  const base = (Math.min(5, Math.max(0, r)) / 5) * weight;
  const conf = n >= 5 ? 1 : n >= 2 ? 0.9 : n === 1 ? 0.8 : 0.7;
  return Math.round(base * conf * 10) / 10;
}

export function responseScore(
  avgResponseHours?: number | null,
  weight = DEFAULT_MATCH_WEIGHTS.response
): number {
  // Prior curve against max 20 → scale by weight/20
  const scale = weight / 20;
  let base: number;
  if (avgResponseHours == null || !Number.isFinite(avgResponseHours)) {
    base = 10; // unknown → mid
  } else {
    const h = avgResponseHours;
    if (h <= 2) base = 20;
    else if (h <= 6) base = 16;
    else if (h <= 12) base = 14;
    else if (h <= 24) base = 10;
    else if (h <= 48) base = 6;
    else base = 2;
  }
  return Math.round(base * scale * 10) / 10;
}

export function distanceScore(
  job: ScoreableJob,
  pro: ScoreablePro,
  weight = DEFAULT_MATCH_WEIGHTS.distance
): { score: number; distanceKm: number | null } {
  const scale = weight / 20;
  const dist = haversineKm(job.lat, job.lng, pro.lat, pro.lng);
  let base: number;
  if (dist != null) {
    if (dist <= 5) base = 20;
    else if (dist <= 10) base = 16;
    else if (dist <= 25) base = 12;
    else if (dist <= 40) base = 6;
    else base = 1;
    return { score: Math.round(base * scale * 10) / 10, distanceKm: dist };
  }
  const cityMatch =
    job.city &&
    pro.city &&
    job.city.toLowerCase().trim() === pro.city.toLowerCase().trim();
  const inAreas =
    job.city &&
    pro.serviceAreas &&
    pro.serviceAreas.toLowerCase().includes(job.city.toLowerCase().trim());
  if (cityMatch || inAreas) return { score: Math.round(10 * scale * 10) / 10, distanceKm: null };
  return { score: 0, distanceKm: null };
}

export function scoreProForJob(
  job: ScoreableJob,
  pro: ScoreablePro,
  weights: MatchWeights = DEFAULT_MATCH_WEIGHTS
): MatchScoreBreakdown {
  const w = weights || DEFAULT_MATCH_WEIGHTS;
  const sk = skillOverlapScore(job.category, pro.skills, w.skills);
  const rating = ratingScore(pro.averageRating, pro.reviewCount, w.rating);
  const response = responseScore(pro.avgResponseHours, w.response);
  const dist = distanceScore(job, pro, w.distance);
  const total =
    Math.round((sk.score + rating + response + dist.score) * 10) / 10;
  return {
    skills: sk.score,
    rating,
    response,
    distance: dist.score,
    total,
    skillHits: sk.hits,
    distanceKm: dist.distanceKm,
    avgResponseHours: pro.avgResponseHours ?? null,
    weights: { ...w },
  };
}

export { escrowAmountFromBid } from "../domain/escrow";
