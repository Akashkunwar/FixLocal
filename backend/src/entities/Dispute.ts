import {
  Column,
  Index,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { Job } from "./Job";
import { User } from "./User";

export enum DisputeStatus {
  OPEN = "open",
  RESOLVED = "resolved",
}

export enum DisputeResolution {
  FAVOR_HOMEOWNER = "favor_homeowner",
  FAVOR_TRADESPERSON = "favor_tradesperson",
  NO_ACTION = "no_action",
}

@Entity("disputes")
@Index(["jobId"])
@Index("UQ_dispute_one_open_per_job", ["jobId"], { unique: true, where: `"status" = 'open'` })
export class Dispute {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  jobId!: string;

  @ManyToOne(() => Job, (job) => job.disputes, { onDelete: "CASCADE" })
  @JoinColumn({ name: "jobId" })
  job!: Job;

  @Column({ type: "uuid" })
  raisedByUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "raisedByUserId" })
  raisedBy!: User;

  @Column({ type: "text" })
  reason!: string;

  /** Job status when the dispute was opened; restored on a "no action" resolution. */
  @Column({ type: "varchar", length: 32, nullable: true })
  previousJobStatus?: string | null;

  @Column({ type: "jsonb", default: [] })
  evidenceUrls!: string[];

  @Column({ type: "enum", enum: DisputeStatus, default: DisputeStatus.OPEN })
  status!: DisputeStatus;

  @Column({ type: "enum", enum: DisputeResolution, nullable: true })
  resolution?: DisputeResolution;

  @Column({ type: "text", nullable: true })
  resolutionNotes?: string;

  /** Simulated escrow refunds applied at resolve time. */
  @Column({ type: "jsonb", nullable: true })
  refundMeta?: {
    milestoneIds: string[];
    totalRefunded: number;
    labels?: string[];
    releasedMilestoneIds?: string[];
    totalReleased?: number;
    notRefundable?: string[];
  } | null;

  @Column({ type: "timestamptz", nullable: true })
  resolvedAt?: Date;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
