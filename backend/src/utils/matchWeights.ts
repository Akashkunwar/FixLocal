import { AppDataSource } from "../data-source";
import { AppConfig } from "../entities/AppConfig";

export type MatchWeights = {
  skills: number;
  rating: number;
  response: number;
  distance: number;
};

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  skills: 35,
  rating: 25,
  response: 20,
  distance: 20,
};


export type MatchWeightPresetId = "balanced" | "speed" | "quality" | "availability";

export type MatchWeightPreset = {
  id: MatchWeightPresetId;
  label: string;
  description: string;
  weights: MatchWeights;
  /** Availability-heat boost cap baked into the preset (0–20). */
  heatWeight: number;
};

export const MATCH_WEIGHT_PRESETS: Record<MatchWeightPresetId, MatchWeightPreset> = {
  balanced: {
    id: "balanced",
    label: "Balanced",
    description: "Default mix — skills, rating, response, distance + moderate heat",
    weights: { skills: 35, rating: 25, response: 20, distance: 20 },
    heatWeight: 10,
  },
  speed: {
    id: "speed",
    label: "Speed-biased",
    description: "Prefer fast responders + open schedules (higher heat boost)",
    weights: { skills: 25, rating: 15, response: 40, distance: 20 },
    heatWeight: 15,
  },
  quality: {
    id: "quality",
    label: "Quality-biased",
    description: "Prefer high ratings and skill overlap; lighter heat boost",
    weights: { skills: 40, rating: 35, response: 10, distance: 15 },
    heatWeight: 8,
  },
  availability: {
    id: "availability",
    label: "Availability-first",
    description: "Prefer open schedules (max heat) + nearby / faster responders",
    weights: { skills: 20, rating: 15, response: 30, distance: 35 },
    heatWeight: 20,
  },
};

export const MATCH_WEIGHTS_KEY = "match_weights";

export function normalizeMatchWeights(
  raw?: Partial<MatchWeights> | Record<string, unknown> | null
): MatchWeights {
  const pick = (k: keyof MatchWeights, fallback: number) => {
    const n = Number((raw as any)?.[k]);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.min(100, Math.round(n * 10) / 10);
  };
  return {
    skills: pick("skills", DEFAULT_MATCH_WEIGHTS.skills),
    rating: pick("rating", DEFAULT_MATCH_WEIGHTS.rating),
    response: pick("response", DEFAULT_MATCH_WEIGHTS.response),
    distance: pick("distance", DEFAULT_MATCH_WEIGHTS.distance),
  };
}

export function weightsSum(w: MatchWeights): number {
  return Math.round((w.skills + w.rating + w.response + w.distance) * 10) / 10;
}

export async function getMatchWeights(): Promise<MatchWeights> {
  try {
    const row = await AppDataSource.getRepository(AppConfig).findOne({
      where: { key: MATCH_WEIGHTS_KEY },
    });
    if (!row?.value) return { ...DEFAULT_MATCH_WEIGHTS };
    return normalizeMatchWeights(row.value as Partial<MatchWeights>);
  } catch {
    return { ...DEFAULT_MATCH_WEIGHTS };
  }
}

export async function setMatchWeights(
  raw: Partial<MatchWeights>
): Promise<MatchWeights> {
  const value = normalizeMatchWeights(raw);
  const repo = AppDataSource.getRepository(AppConfig);
  let row = await repo.findOne({ where: { key: MATCH_WEIGHTS_KEY } });
  if (!row) {
    row = repo.create({ key: MATCH_WEIGHTS_KEY, value });
  } else {
    row.value = value;
  }
  await repo.save(row);
  return value;
}

/** Max availability-heat boost added to match total for clean schedules (0–20). */
export const DEFAULT_HEAT_WEIGHT = 10;
export const MATCH_HEAT_WEIGHT_KEY = "match_heat_weight";

export function normalizeHeatWeight(raw?: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_HEAT_WEIGHT;
  return Math.min(20, Math.round(n * 10) / 10);
}

/** Detect preset from sk/rt/rs/ds; when heatWeight is passed, it must match the preset too. */
export function detectMatchPreset(
  w: MatchWeights,
  heatWeight?: number | null
): MatchWeightPresetId | null {
  for (const preset of Object.values(MATCH_WEIGHT_PRESETS)) {
    const p = preset.weights;
    if (
      p.skills === w.skills &&
      p.rating === w.rating &&
      p.response === w.response &&
      p.distance === w.distance
    ) {
      if (heatWeight != null && Number.isFinite(Number(heatWeight))) {
        if (normalizeHeatWeight(heatWeight) !== normalizeHeatWeight(preset.heatWeight)) {
          continue;
        }
      }
      return preset.id;
    }
  }
  return null;
}

export async function getHeatWeight(): Promise<number> {
  try {
    const row = await AppDataSource.getRepository(AppConfig).findOne({
      where: { key: MATCH_HEAT_WEIGHT_KEY },
    });
    if (!row?.value) return DEFAULT_HEAT_WEIGHT;
    const v = (row.value as Record<string, unknown>).heatWeight;
    return normalizeHeatWeight(v);
  } catch {
    return DEFAULT_HEAT_WEIGHT;
  }
}

export async function setHeatWeight(raw: unknown): Promise<number> {
  const heatWeight = normalizeHeatWeight(raw);
  const repo = AppDataSource.getRepository(AppConfig);
  let row = await repo.findOne({ where: { key: MATCH_HEAT_WEIGHT_KEY } });
  if (!row) {
    row = repo.create({ key: MATCH_HEAT_WEIGHT_KEY, value: { heatWeight } });
  } else {
    row.value = { heatWeight };
  }
  await repo.save(row);
  return heatWeight;
}

/** Clean-schedule heat boost: 0 … heatWeight, proportional to availability heat score 0–100. */
export function computeHeatBoost(
  availabilityHeat: { score?: number; clean?: boolean } | null | undefined,
  heatWeight: number = DEFAULT_HEAT_WEIGHT
): number {
  const max = normalizeHeatWeight(heatWeight);
  if (!availabilityHeat?.clean || max <= 0) return 0;
  const score = Number(availabilityHeat.score || 0);
  if (!Number.isFinite(score) || score <= 0) return 0;
  return Math.min(max, Math.round((score * max) / 100));
}

/** Best-value bid blend: match % vs lower-price % (+ optional SLA/heat %) — admin-tunable; sums to 100. */
export type BestValueBlend = {
  matchPct: number;
  pricePct: number;
  /** Optional third weight: fold response SLA + availability heat into blend (0 = off). */
  slaHeatPct: number;
};

export const DEFAULT_BEST_VALUE_BLEND: BestValueBlend = {
  matchPct: 55,
  pricePct: 45,
  slaHeatPct: 0,
};


export type BestValueBlendPresetId = "match_heavy" | "price_heavy" | "balanced_sla";

export type BestValueBlendPreset = {
  id: BestValueBlendPresetId;
  label: string;
  description: string;
  blend: BestValueBlend;
};

/** Named best-value blend presets (wave 24). */
export const BEST_VALUE_BLEND_PRESETS: Record<BestValueBlendPresetId, BestValueBlendPreset> = {
  match_heavy: {
    id: "match_heavy",
    label: "Match-heavy",
    description: "Prefer higher match / ranked score over lower escrow hold",
    blend: { matchPct: 70, pricePct: 30, slaHeatPct: 0 },
  },
  price_heavy: {
    id: "price_heavy",
    label: "Price-heavy",
    description: "Prefer lower simulated escrow hold over match score",
    blend: { matchPct: 30, pricePct: 70, slaHeatPct: 0 },
  },
  balanced_sla: {
    id: "balanced_sla",
    label: "Balanced + SLA",
    description: "Match + price + response SLA / availability heat third weight",
    blend: { matchPct: 50, pricePct: 35, slaHeatPct: 15 },
  },
};

export function detectBestValueBlendPreset(
  b: BestValueBlend
): BestValueBlendPresetId | null {
  const n = normalizeBestValueBlend(b);
  for (const preset of Object.values(BEST_VALUE_BLEND_PRESETS)) {
    if (blendsEqual(n, normalizeBestValueBlend(preset.blend))) return preset.id;
  }
  return null;
}

export const BEST_VALUE_BLEND_KEY = "best_value_blend";

export function blendsEqual(a: BestValueBlend, b: BestValueBlend): boolean {
  return (
    Number(a.matchPct) === Number(b.matchPct) &&
    Number(a.pricePct) === Number(b.pricePct) &&
    Number(a.slaHeatPct ?? 0) === Number(b.slaHeatPct ?? 0)
  );
}

export function normalizeBestValueBlend(
  raw?: Partial<BestValueBlend> | Record<string, unknown> | null
): BestValueBlend {
  let matchPct = Number((raw as any)?.matchPct);
  let pricePct = Number((raw as any)?.pricePct);
  let slaHeatPct = Number((raw as any)?.slaHeatPct);
  if (!Number.isFinite(matchPct) || matchPct < 0) matchPct = DEFAULT_BEST_VALUE_BLEND.matchPct;
  if (!Number.isFinite(pricePct) || pricePct < 0) pricePct = DEFAULT_BEST_VALUE_BLEND.pricePct;
  // Missing slaHeatPct → 0 (backward compatible with wave 22 two-weight blend)
  if (!Number.isFinite(slaHeatPct) || slaHeatPct < 0) slaHeatPct = 0;
  matchPct = Math.min(100, Math.round(matchPct * 10) / 10);
  pricePct = Math.min(100, Math.round(pricePct * 10) / 10);
  slaHeatPct = Math.min(100, Math.round(slaHeatPct * 10) / 10);
  const sum = matchPct + pricePct + slaHeatPct;
  if (sum <= 0) return { ...DEFAULT_BEST_VALUE_BLEND };
  // Renormalize to 100 while keeping relative mix
  matchPct = Math.round((matchPct / sum) * 1000) / 10;
  pricePct = Math.round((pricePct / sum) * 1000) / 10;
  slaHeatPct = Math.round((100 - matchPct - pricePct) * 10) / 10;
  if (slaHeatPct < 0) slaHeatPct = 0;
  return { matchPct, pricePct, slaHeatPct };
}

export async function getBestValueBlend(): Promise<BestValueBlend> {
  try {
    const row = await AppDataSource.getRepository(AppConfig).findOne({
      where: { key: BEST_VALUE_BLEND_KEY },
    });
    if (!row?.value) return { ...DEFAULT_BEST_VALUE_BLEND };
    return normalizeBestValueBlend(row.value as Partial<BestValueBlend>);
  } catch {
    return { ...DEFAULT_BEST_VALUE_BLEND };
  }
}

export async function setBestValueBlend(
  raw: Partial<BestValueBlend> | Record<string, unknown> | null | undefined
): Promise<BestValueBlend> {
  const value = normalizeBestValueBlend(raw);
  const repo = AppDataSource.getRepository(AppConfig);
  let row = await repo.findOne({ where: { key: BEST_VALUE_BLEND_KEY } });
  if (!row) {
    row = repo.create({ key: BEST_VALUE_BLEND_KEY, value: value as unknown as Record<string, unknown> });
  } else {
    row.value = value as unknown as Record<string, unknown>;
  }
  await repo.save(row);
  return value;
}
