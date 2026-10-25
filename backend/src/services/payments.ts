import crypto from "node:crypto";
import { LedgerType } from "../entities/LedgerEntry";

/**
 * Payment provider boundary for escrow. Every money movement the ledger records goes through
 * here first and the provider's reference is stored on the ledger row.
 *
 * FixLocal ships with the simulated provider only: no card data, no real charges.
 * A real gateway (e.g. Razorpay: Orders + Payments for `hold`, Route transfers to the pro's
 * linked account for `release`, the Refunds API for `refund`) implements this interface once
 * KYC / merchant onboarding is done. See docs/LAUNCH_READINESS.md → "Payments".
 */
export type MoneyMovement = {
  type: LedgerType;
  jobId: string;
  milestoneId: string | null;
  amount: number;
  currency: "INR";
  payerUserId: string | null;
  payeeUserId: string | null;
  /** Stable per movement so a retried call can't move money twice. */
  idempotencyKey: string;
};

export type MovementResult = { reference: string };

export interface PaymentProvider {
  readonly name: string;
  /** Whether this provider moves real money (the UI keeps the "simulated" labels while false). */
  readonly live: boolean;
  record(movement: MoneyMovement): Promise<MovementResult>;
}

export class SimulatedPaymentProvider implements PaymentProvider {
  readonly name = "simulated";
  readonly live = false;
  async record(m: MoneyMovement): Promise<MovementResult> {
    if (!(m.amount >= 0) || !Number.isFinite(m.amount)) throw new Error("Invalid amount");
    const digest = crypto.createHash("sha256").update(m.idempotencyKey).digest("hex").slice(0, 24);
    return { reference: `sim_${m.type}_${digest}` };
  }
}

let active: PaymentProvider = new SimulatedPaymentProvider();

export function paymentProvider(): PaymentProvider {
  return active;
}

/** Tests / a future gateway adapter. */
export function setPaymentProvider(p: PaymentProvider) {
  active = p;
}
