/** Client-side escrow what-if (mirrors backend previewEscrowSplit 30/40/30). */

export const ESCROW_MILESTONE_TEMPLATE = [
  { label: "Deposit", percent: 30 },
  { label: "Progress", percent: 40 },
  { label: "Completion", percent: 30 },
] as const;

export type EscrowWhatIfMilestone = {
  label: string;
  sequence: number;
  percent: number;
  amount: number;
};

export function previewEscrowSplit(totalAmount: number): {
  amount: number;
  milestones: EscrowWhatIfMilestone[];
} {
  const total = Math.round(Number(totalAmount) * 100) / 100;
  if (!Number.isFinite(total) || total <= 0) {
    return { amount: 0, milestones: [] };
  }
  const milestones: EscrowWhatIfMilestone[] = [];
  let allocated = 0;
  for (let i = 0; i < ESCROW_MILESTONE_TEMPLATE.length; i++) {
    const tmpl = ESCROW_MILESTONE_TEMPLATE[i];
    const isLast = i === ESCROW_MILESTONE_TEMPLATE.length - 1;
    const amount = isLast
      ? Math.round((total - allocated) * 100) / 100
      : Math.round(((total * tmpl.percent) / 100) * 100) / 100;
    allocated += amount;
    milestones.push({
      label: tmpl.label,
      sequence: i + 1,
      percent: tmpl.percent,
      amount,
    });
  }
  return { amount: total, milestones };
}

/** Prefer structured quote when present; else bid amount. */
export function escrowHoldAmount(bid: {
  amount?: number | string | null;
  quoteAmount?: number | string | null;
}): number {
  const q = Number(bid.quoteAmount);
  if (Number.isFinite(q) && q > 0) return q;
  const a = Number(bid.amount);
  return Number.isFinite(a) && a > 0 ? a : 0;
}
