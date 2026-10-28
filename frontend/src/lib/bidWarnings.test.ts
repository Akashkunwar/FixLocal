import { describe, expect, it } from "vitest";
import { lowBidWarning } from "./bidWarnings";

describe("lowBidWarning", () => {
  it("warns about a bid far below the budget (₹5 on a ₹500–2000 job)", () => {
    expect(lowBidWarning(5, 500)).toMatch(/far below/);
  });
  it("stays quiet for a normal bid or when there is no budget", () => {
    expect(lowBidWarning(450, 500)).toBeNull();
    expect(lowBidWarning(5, null)).toBeNull();
    expect(lowBidWarning(NaN, 500)).toBeNull();
  });
});
