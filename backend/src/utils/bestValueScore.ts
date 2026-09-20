/** Best-value bid blend scoring (mirrors homeowner bid-compare client logic). */

import type { BestValueBlend } from "./matchWeights";
import { normalizeBestValueBlend } from "./matchWeights";

export type BestValueBidInput = {
  bidId: string;
  name?: string | null;
  /** rankedScore preferred, else matchScore */
  matchScore: number;
  /** Simulated escrow hold (quote preferred, else bid amount) */
  hold: number;
  heatBoost?: number | null;
  responseSlaTier?: string | null;
};

export type BestValueScoredRow = {
  bidId: string;
  name: string;
  matchScore: number;
  hold: number;
  matchNorm: number;
  priceNorm: number;
  slaHeatNorm: number;
  slaHeatRaw: number;
  valueScore: number;
  matchPct: number;
  pricePct: number;
  slaHeatPct: number;
};

export function slaTierPoints(tier?: string | null): number {
  if (tier === "lightning") return 20;
  if (tier === "fast") return 15;
  if (tier === "same_day") return 10;
  if (tier === "steady") return 5;
  if (tier === "slow") return 0;
  return 5; // unknown / missing — soft middle
}

export function escrowHoldFromAmounts(
  quoteAmount?: number | string | null,
  amount?: number | string | null
): number {
  const q = Number(quoteAmount);
  if (Number.isFinite(q) && q > 0) return q;
  const a = Number(amount);
  return Number.isFinite(a) && a > 0 ? a : 0;
}

/** Rank active bids by best-value blend. Needs ≥2 clean bids with hold + score. */
export function scoreBestValueBids(
  bids: BestValueBidInput[],
  blendRaw?: Partial<BestValueBlend> | null
): {
  rows: BestValueScoredRow[];
  bestBidId: string | null;
  matchPct: number;
  pricePct: number;
  slaHeatPct: number;
  clean: boolean;
} | null {
  const blend = normalizeBestValueBlend(blendRaw);
  const active = bids.filter(
    (b) => b.hold > 0 && Number.isFinite(b.matchScore)
  );
  if (active.length < 2) return null;

  const scores = active.map((b) => b.matchScore);
  const holds = active.map((b) => b.hold);
  const slaHeats = active.map(
    (b) => Number(b.heatBoost || 0) + slaTierPoints(b.responseSlaTier)
  );
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const minHold = Math.min(...holds);
  const maxHold = Math.max(...holds);
  const minSla = Math.min(...slaHeats);
  const maxSla = Math.max(...slaHeats);
  const scoreSpan = Math.max(1, maxScore - minScore);
  const holdSpan = Math.max(1, maxHold - minHold);
  const slaSpan = Math.max(1, maxSla - minSla);

  let matchW = blend.matchPct;
  let priceW = blend.pricePct;
  let slaW = blend.slaHeatPct;
  const wSum = matchW + priceW + slaW || 100;
  matchW = matchW / wSum;
  priceW = priceW / wSum;
  slaW = slaW / wSum;
  const matchPct = Math.round(matchW * 1000) / 10;
  const pricePct = Math.round(priceW * 1000) / 10;
  const slaHeatPct = Math.round(slaW * 1000) / 10;

  const rows: BestValueScoredRow[] = active.map((b) => {
    const slaHeatRaw = Number(b.heatBoost || 0) + slaTierPoints(b.responseSlaTier);
    const matchNorm = (b.matchScore - minScore) / scoreSpan;
    const priceNorm = (maxHold - b.hold) / holdSpan;
    const slaHeatNorm = (slaHeatRaw - minSla) / slaSpan;
    const valueScore =
      Math.round((matchW * matchNorm + priceW * priceNorm + slaW * slaHeatNorm) * 1000) / 10;
    return {
      bidId: b.bidId,
      name: b.name || "Pro",
      matchScore: b.matchScore,
      hold: b.hold,
      matchNorm,
      priceNorm,
      slaHeatNorm,
      slaHeatRaw,
      valueScore,
      matchPct,
      pricePct,
      slaHeatPct,
    };
  });
  rows.sort((a, b) => b.valueScore - a.valueScore);
  return {
    rows,
    bestBidId: rows[0]?.bidId || null,
    matchPct,
    pricePct,
    slaHeatPct,
    clean: rows.length >= 2 && rows.every((r) => r.hold > 0),
  };
}
