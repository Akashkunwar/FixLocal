import {
  Column,
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
  } | null;

  @Column({ type: "timestamptz", nullable: true })
  resolvedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
