import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { Job } from "./Job";
import { User } from "./User";

export enum BidStatus {
  ACTIVE = "active",
  WITHDRAWN = "withdrawn",
  REJECTED = "rejected",
  ACCEPTED = "accepted",
}

@Entity("bids")
@Index(["jobId"])
@Index(["tradespersonId"])
export class Bid {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  jobId!: string;

  @ManyToOne(() => Job, (job) => job.bids, { onDelete: "CASCADE" })
  @JoinColumn({ name: "jobId" })
  job!: Job;

  @Column({ type: "uuid" })
  tradespersonId!: string;

  @ManyToOne(() => User, (user) => user.bids, { onDelete: "CASCADE" })
  @JoinColumn({ name: "tradespersonId" })
  tradesperson!: User;

  @Column({ type: "decimal", precision: 10, scale: 2 })
  amount!: number;

  @Column({ type: "text", nullable: true })
  message?: string;

  @Column({ type: "int", nullable: true })
  etaDays?: number;

  /** Proposed visit window from the pro (optional at bid time). */
  @Column({ type: "timestamptz", nullable: true })
  proposedVisitStart?: Date;

  @Column({ type: "timestamptz", nullable: true })
  proposedVisitEnd?: Date;

  /** Structured estimate/quote (may match bid amount or be a detailed breakdown). */
  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  quoteAmount?: number;

  @Column({ type: "text", nullable: true })
  quoteNotes?: string;

  /** Optional PDF/image supporting the quote (multer path). */
  @Column({ type: "varchar", nullable: true })
  quoteAttachmentUrl?: string;

  /** Prior quote revisions when the pro edits quoteAmount/notes/attachment. */
  @Column({ type: "jsonb", nullable: true })
  quoteHistory?: Array<{
    amount?: number | null;
    notes?: string | null;
    attachmentUrl?: string | null;
    revisedAt: string;
  }> | null;

  /** Homeowner counter-offer / request-revise on the structured quote. */
  @Column({ type: "jsonb", nullable: true })
  counterOffer?: {
    suggestedAmount: number;
    notes?: string | null;
    requestedAt: string;
    status: "pending" | "addressed" | "dismissed" | "declined";
    addressedAt?: string | null;
    declinedAt?: string | null;
    declinedNotes?: string | null;
  } | null;

  /** Prior counter-offers (archived when replaced or closed). */
  @Column({ type: "jsonb", nullable: true })
  counterHistory?: Array<{
    suggestedAmount: number;
    notes?: string | null;
    requestedAt: string;
    status: "pending" | "addressed" | "dismissed" | "declined";
    resolvedAt?: string | null;
    addressedAt?: string | null;
    declinedAt?: string | null;
    declinedNotes?: string | null;
  }> | null;

  /** Last time homeowner opened/viewed a revised quote (for pro alert). */
  @Column({ type: "timestamptz", nullable: true })
  quoteViewedAt?: Date | null;

  /** quoteHistory length when homeowner last viewed (dedupe view alerts). */
  @Column({ type: "int", nullable: true })
  quoteViewedRevisionCount?: number | null;

  /** When we last sent a "viewed but no reply" nudge to the pro. */
  @Column({ type: "timestamptz", nullable: true })
  quoteViewedNudgeSentAt?: Date | null;

  @Column({ type: "enum", enum: BidStatus, default: BidStatus.ACTIVE })
  status!: BidStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
