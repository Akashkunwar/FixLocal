import { numeric } from "../db/numeric";
import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export enum LedgerType {
  /** Money the client funded into escrow. */
  HOLD = "hold",
  /** Client-funded escrow paid to the professional. */
  RELEASE = "release",
  /** Client-funded escrow returned to the client. */
  REFUND = "refund",
  /** The part of a milestone FixLocal funded with the client's referral credit. */
  CREDIT_HOLD = "credit_hold",
  /** Credit-funded escrow paid to the professional. */
  CREDIT_RELEASE = "credit_release",
  /** Credit-funded escrow that went unused (the credit goes back to the client's balance). */
  CREDIT_REFUND = "credit_refund",
  /** A professional's own referral credit, paid out on top of a release. */
  CREDIT_PAYOUT = "credit_payout",
  /** Client-funded money already released, returned by the professional (they cancelled before starting). */
  CLAWBACK = "clawback",
}

/** What a professional is paid (their earnings). */
export const PAYOUT_TYPES = [LedgerType.RELEASE, LedgerType.CREDIT_RELEASE, LedgerType.CREDIT_PAYOUT] as const;

/** Append-only record of simulated escrow movements. Earnings and GMV derive from it. */
@Entity("ledger_entries")
@Index(["jobId", "createdAt"])
// Each milestone moves each kind of money once (held, then released or refunded).
@Index("UQ_ledger_milestone_type", ["milestoneId", "type"], { unique: true, where: `"milestoneId" IS NOT NULL` })
@Index(["payeeUserId", "type"])
@Check("CHK_ledger_amount", `"amount" >= 0`)
export class LedgerEntry {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  jobId!: string;

  @Column({ type: "uuid", nullable: true })
  milestoneId?: string | null;

  @Column({ type: "varchar", length: 16 })
  type!: LedgerType;

  @Column({ type: "decimal", precision: 12, scale: 2, transformer: numeric })
  amount!: number;

  /** Professional who receives released funds. */
  @Column({ type: "uuid", nullable: true })
  payeeUserId?: string | null;

  /** Client who funded the escrow. */
  @Column({ type: "uuid", nullable: true })
  payerUserId?: string | null;

  @Column({ type: "uuid", nullable: true })
  actorUserId?: string | null;

  @Column({ type: "text", nullable: true })
  note?: string | null;

  /** Reference returned by the payment provider for this movement ("sim_…" while simulated). */
  @Column({ type: "varchar", length: 80, nullable: true })
  providerRef?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
