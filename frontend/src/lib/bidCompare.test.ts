import { describe, expect, it } from "vitest";
import type { Bid } from "../api/jobs";
import {
  bidHighlights,
  budgetFit,
  effectivePrice,
  skillList,
  sortBids,
  trustedRating,
} from "./bidCompare";

const bid = (id: string, over: Partial<Bid> = {}): Bid =>
  ({
    id,
    jobId: "j",
    tradespersonId: `pro-${id}`,
    amount: 1000,
    status: "active",
    createdAt: "2026-10-01T00:00:00Z",
    ...over,
  }) as Bid;

describe("bid comparison helpers", () => {
  it("uses the structured quote as the price when there is one", () => {
    expect(effectivePrice(bid("a", { amount: 1000, quoteAmount: 1200 }))).toBe(
      1200,
    );
    expect(effectivePrice(bid("a", { amount: 900 }))).toBe(900);
  });

  it("doesn't let one 5-star review beat a long track record", () => {
    const fresh = bid("a", { profile: { averageRating: 5, reviewCount: 1 } });
    const proven = bid("b", {
      profile: { averageRating: 4.8, reviewCount: 40 },
    });
    expect(trustedRating(proven)).toBeGreaterThan(trustedRating(fresh));
    expect(trustedRating(bid("c"))).toBe(0);
  });

  it("tags single clear winners only, and only when there's something to compare", () => {
    const a = bid("a", {
      amount: 800,
      etaDays: 3,
      profile: { averageRating: 4.9, reviewCount: 30, completedJobs: 12 },
    });
    const b = bid("b", {
      amount: 1200,
      etaDays: 1,
      profile: { averageRating: 4.2, reviewCount: 5, completedJobs: 2 },
    });
    const tags = bidHighlights([a, b], "b");
    expect(tags.get("a")).toEqual([
      "lowest_price",
      "top_rated",
      "most_experienced",
    ]);
    expect(tags.get("b")).toEqual(["best_value", "fastest"]);
    expect(bidHighlights([a]).size).toBe(0);
    // A tie gives nobody the tag.
    const tie = bidHighlights([
      bid("x", { amount: 500 }),
      bid("y", { amount: 500 }),
    ]);
    expect(tie.size).toBe(0);
  });

  it("ignores withdrawn bids when tagging and sorts them last", () => {
    const cheapButGone = bid("gone", { amount: 100, status: "withdrawn" });
    const a = bid("a", { amount: 900 });
    const b = bid("b", { amount: 1000 });
    expect(bidHighlights([cheapButGone, a, b]).get("a")).toEqual([
      "lowest_price",
    ]);
    expect(sortBids([cheapButGone, b, a], "price").map((x) => x.id)).toEqual([
      "a",
      "b",
      "gone",
    ]);
  });

  it("sorts by each key, missing values last, stable on ties", () => {
    const a = bid("a", { amount: 900, etaDays: null, distanceKm: 4 });
    const b = bid("b", { amount: 700, etaDays: 2, distanceKm: null });
    const c = bid("c", { amount: 900, etaDays: 1, distanceKm: 1 });
    expect(sortBids([a, b, c], "price").map((x) => x.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(sortBids([a, b, c], "eta").map((x) => x.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(sortBids([a, b, c], "distance").map((x) => x.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    const scores = new Map([
      ["a", 40],
      ["b", 90],
      ["c", 60],
    ]);
    expect(sortBids([a, b, c], "recommended", scores).map((x) => x.id)).toEqual(
      ["b", "c", "a"],
    );
  });

  it("explains the price against the budget", () => {
    expect(budgetFit(1500, 1000, 2000)).toEqual({ kind: "within", by: 0 });
    expect(budgetFit(2500, 1000, 2000)).toEqual({ kind: "over", by: 500 });
    expect(budgetFit(800, 1000, 2000)).toEqual({ kind: "under", by: 200 });
    expect(budgetFit(800, null, null)).toBeNull();
  });

  it("splits skills into a short list", () => {
    expect(
      skillList("Plumbing, leak repair; geyser\nbathroom fittings, tiling", 3),
    ).toEqual(["Plumbing", "leak repair", "geyser"]);
    expect(skillList(null)).toEqual([]);
  });
});
