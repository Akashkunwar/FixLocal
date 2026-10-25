import { bidEscrowAmount, type Bid } from "../api/jobs";

/** What the client would actually pay: the structured quote if there is one, else the bid. */
export const effectivePrice = (b: Pick<Bid, "amount" | "quoteAmount">) =>
  bidEscrowAmount(b);

export type BidSortKey =
  "recommended" | "price" | "rating" | "experience" | "eta" | "distance";

export const BID_SORT_OPTIONS: { key: BidSortKey; label: string }[] = [
  { key: "recommended", label: "Recommended" },
  { key: "price", label: "Lowest price" },
  { key: "rating", label: "Highest rated" },
  { key: "experience", label: "Most jobs done" },
  { key: "eta", label: "Fastest" },
  { key: "distance", label: "Nearest" },
];

export type BidHighlight =
  "best_value" | "lowest_price" | "top_rated" | "fastest" | "most_experienced";

export const HIGHLIGHT_LABEL: Record<BidHighlight, string> = {
  best_value: "Best value",
  lowest_price: "Lowest price",
  top_rated: "Top rated",
  fastest: "Fastest",
  most_experienced: "Most experienced",
};

const isLive = (b: Pick<Bid, "status">) =>
  b.status === "active" || b.status === "accepted";

/** Bayesian-ish rating: a 5.0 from one review shouldn't beat a 4.8 from forty. */
export function trustedRating(b: Pick<Bid, "profile">): number {
  const avg = Number(b.profile?.averageRating || 0);
  const n = Number(b.profile?.reviewCount || 0);
  if (!n) return 0;
  const prior = 4;
  const weight = 3;
  return (avg * n + prior * weight) / (n + weight);
}

const finiteOr = (v: unknown, fallback: number) => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : fallback;
};

/**
 * Tags shown next to the bids that stand out. A tag is only given when there is
 * something to compare (2+ live bids) and only to a single, unambiguous winner.
 */
export function bidHighlights(
  bids: Bid[],
  bestBidId?: string | null,
): Map<string, BidHighlight[]> {
  const out = new Map<string, BidHighlight[]>();
  const live = bids.filter(isLive);
  if (live.length < 2) return out;
  const add = (id: string, h: BidHighlight) =>
    out.set(id, [...(out.get(id) ?? []), h]);
  const winner = (
    score: (b: Bid) => number | null,
    higherIsBetter: boolean,
  ) => {
    const scored = live
      .map((b) => ({ b, v: score(b) }))
      .filter(
        (x): x is { b: Bid; v: number } => x.v != null && Number.isFinite(x.v),
      );
    if (scored.length < 2) return null;
    scored.sort((x, y) => (higherIsBetter ? y.v - x.v : x.v - y.v));
    return scored[0].v === scored[1].v ? null : scored[0].b.id;
  };
  if (bestBidId && live.some((b) => b.id === bestBidId))
    add(bestBidId, "best_value");
  const cheapest = winner(
    (b) => (effectivePrice(b) > 0 ? effectivePrice(b) : null),
    false,
  );
  if (cheapest) add(cheapest, "lowest_price");
  const rated = winner(
    (b) => (b.profile?.reviewCount ? trustedRating(b) : null),
    true,
  );
  if (rated) add(rated, "top_rated");
  const fastest = winner(
    (b) => (b.etaDays != null ? Number(b.etaDays) : null),
    false,
  );
  if (fastest) add(fastest, "fastest");
  const experienced = winner(
    (b) => (b.profile?.completedJobs ? Number(b.profile.completedJobs) : null),
    true,
  );
  if (experienced) add(experienced, "most_experienced");
  return out;
}

/** Stable sort; live bids always come before withdrawn/declined ones. */
export function sortBids(
  bids: Bid[],
  key: BidSortKey,
  valueScores?: Map<string, number>,
): Bid[] {
  const cmp: Record<BidSortKey, (a: Bid, b: Bid) => number> = {
    recommended: (a, b) => {
      if (valueScores && valueScores.size) {
        return (
          finiteOr(valueScores.get(b.id), -1) -
          finiteOr(valueScores.get(a.id), -1)
        );
      }
      return (
        trustedRating(b) - trustedRating(a) ||
        effectivePrice(a) - effectivePrice(b)
      );
    },
    price: (a, b) =>
      finiteOr(effectivePrice(a) || null, Infinity) -
      finiteOr(effectivePrice(b) || null, Infinity),
    rating: (a, b) => trustedRating(b) - trustedRating(a),
    experience: (a, b) =>
      Number(b.profile?.completedJobs ?? 0) -
      Number(a.profile?.completedJobs ?? 0),
    eta: (a, b) =>
      finiteOr(a.etaDays, Infinity) - finiteOr(b.etaDays, Infinity),
    distance: (a, b) =>
      finiteOr(a.distanceKm, Infinity) - finiteOr(b.distanceKm, Infinity),
  };
  return bids
    .map((b, i) => ({ b, i }))
    .sort((x, y) => {
      const live = Number(isLive(y.b)) - Number(isLive(x.b));
      if (live) return live;
      const c = cmp[key](x.b, y.b);
      return (Number.isNaN(c) ? 0 : c) || x.i - y.i;
    })
    .map((x) => x.b);
}

/** "Within budget", "₹500 over budget" or nothing when the job has no budget. */
export function budgetFit(
  price: number,
  budgetMin?: number | string | null,
  budgetMax?: number | string | null,
) {
  const max = Number(budgetMax);
  const min = Number(budgetMin);
  if (!(price > 0)) return null;
  if (Number.isFinite(max) && max > 0 && price > max)
    return { kind: "over" as const, by: Math.round(price - max) };
  if (Number.isFinite(min) && min > 0 && price < min)
    return { kind: "under" as const, by: Math.round(min - price) };
  if ((Number.isFinite(max) && max > 0) || (Number.isFinite(min) && min > 0))
    return { kind: "within" as const, by: 0 };
  return null;
}

export function skillList(skills?: string | null, max = 4): string[] {
  if (!skills) return [];
  return skills
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}
