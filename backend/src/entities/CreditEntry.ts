import { numeric } from "../db/numeric";
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { User } from "./User";

export const CREDIT_KINDS = ["referral_reward", "applied_payment", "applied_payout", "reversal", "restored"] as const;
export type CreditKind = (typeof CREDIT_KINDS)[number];

/**
 * Append-only FixLocal credit ledger (simulated, like escrow). A user's balance is the sum of
 * their rows: rewards are positive; using credit at a payment, or a reversal, is negative.
 */
@Entity("credit_entries")
@Index(["userId", "createdAt"])
@Index(["jobId"])
export class CreditEntry {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ type: "varchar", length: 24 })
  kind!: CreditKind;

  /** Signed rupees: + adds to the balance, − uses or removes it. */
  @Column({ type: "decimal", precision: 12, scale: 2, transformer: numeric })
  amount!: number;

  @Column({ type: "uuid", nullable: true })
  jobId?: string | null;

  @Column({ type: "uuid", nullable: true })
  rewardId?: string | null;

  @Column({ type: "varchar", length: 200, nullable: true })
  note?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
