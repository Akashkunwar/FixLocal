import { numeric } from "../db/numeric";
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { User } from "./User";

export const REFERRAL_REWARD_STATUSES = ["granted", "blocked", "reversed"] as const;
export type ReferralRewardStatus = (typeof REFERRAL_REWARD_STATUSES)[number];

/**
 * The decision on a referred account's first completed job. At most one row per referred
 * account (unique), so a reward can never be paid twice, and blocked attempts are kept for review.
 */
@Entity("referral_rewards")
@Index(["referrerId", "createdAt"])
@Index(["jobId"])
export class ReferralReward {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid", nullable: true })
  referrerId?: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "referrerId" })
  referrer?: User | null;

  @Index({ unique: true })
  @Column({ type: "uuid", nullable: true })
  referredId?: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "referredId" })
  referred?: User | null;

  @Column({ type: "uuid", nullable: true })
  jobId?: string | null;

  @Column({ type: "varchar", length: 12 })
  status!: ReferralRewardStatus;

  /** Why it was blocked, capped or reversed (e.g. same_email, monthly_cap, refunded). */
  @Column({ type: "varchar", length: 40, nullable: true })
  reason?: string | null;

  @Column({ type: "decimal", precision: 12, scale: 2, transformer: numeric, default: 0 })
  referrerAmount!: number;

  @Column({ type: "decimal", precision: 12, scale: 2, transformer: numeric, default: 0 })
  referredAmount!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  reversedAt?: Date | null;
}
