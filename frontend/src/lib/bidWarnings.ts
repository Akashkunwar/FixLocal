import { money } from "./format";
import { tf } from "./t";

/** Below this share of the client's minimum budget a bid is probably a typo (₹5 instead of ₹500). */
export const LOW_BID_RATIO = 0.5;

/** A warning to confirm before placing a bid far below the budget, or null when it looks fine. */
export function lowBidWarning(amount: number, budgetMin?: string | number | null): string | null {
  const min = Number(budgetMin);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(min) || min <= 0) return null;
  if (amount >= min * LOW_BID_RATIO) return null;
  return tf("Your bid of {amount} is far below the client's budget (from {min}). Check for a missing zero before you send it.", {
    amount: money(amount),
    min: money(min),
  });
}
