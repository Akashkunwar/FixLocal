import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { User } from "./User";
import { Bid } from "./Bid";
import { Dispute } from "./Dispute";
import { PaymentMilestone } from "./PaymentMilestone";

export enum JobCategory {
  PLUMBING = "plumbing",
  ELECTRICAL = "electrical",
  CARPENTRY = "carpentry",
  PAINTING = "painting",
  APPLIANCE = "appliance",
  CLEANING = "cleaning",
  CONSTRUCTION = "construction",
  OFFICE_FACILITIES = "office_facilities",
  TECH_SERVICES = "tech_services",
  MOVING = "moving",
  OTHER = "other",
}

export enum JobStatus {
  OPEN = "open",
  BIDDING_CLOSED = "bidding_closed",
  AWARDED = "awarded",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
  DISPUTED = "disputed",
}

/** Simulated payment / escrow only — no real gateway. */
export enum PaymentStatus {
  PENDING = "pending",
  HELD = "held",
  PARTIALLY_RELEASED = "partially_released",
  RELEASED = "released",
  REFUNDED = "refunded",
  /** @deprecated kept for older rows; treat like held */
  SIMULATED_PAID = "simulated_paid",
}

export enum ScheduleStatus {
  NONE = "none",
  PROPOSED = "proposed",
  CONFIRMED = "confirmed",
}

@Entity("jobs")
@Index(["category"])
@Index(["status"])
@Index(["createdAt"])
@Index(["area"])
@Index(["city"])
export class Job {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  title!: string;

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "enum", enum: JobCategory })
  category!: JobCategory;

  /** Soft site tag: residential home vs office/facilities. */
  @Column({ type: "varchar", length: 32, nullable: true })
  siteType?: string | null;

  /**
   * Soft recurring / AMC cadence preference (store only — no full recurring engine).
   * one_time | weekly | monthly | amc
   */
  @Column({ type: "varchar", length: 24, nullable: true, default: "one_time" })
  cadence?: string | null;

  /** Optional note for AMC / recurring preference. */
  @Column({ type: "text", nullable: true })
  cadenceNote?: string | null;

  /**
   * Soft AMC / recurring package proposal (store only — no billing engine).
   * Shape: { status (proposed|requested|accepted|declined|countered), cadence, packageLabel,
   *          amountMin, amountMax?, unit?, note?, proposedByUserId, proposedAt,
   *          replyNote?, repliedAt?, replyCadence? }
   * Client-initiated requests use status "requested"; pro proposals use "proposed".
   */
  @Column({ type: "jsonb", nullable: true })
  amcProposal?: {
    status: "proposed" | "requested" | "accepted" | "declined" | "countered";
    cadence: string;
    packageLabel: string;
    amountMin: number;
    amountMax?: number | null;
    unit?: string | null;
    note?: string | null;
    proposedByUserId: string;
    proposedAt: string;
    replyNote?: string | null;
    repliedAt?: string | null;
    replyCadence?: string | null;
  } | null;

  @Column({ type: "timestamptz", nullable: true })
  preferredStart?: Date;

  @Column({ type: "timestamptz", nullable: true })
  preferredEnd?: Date;

  @Column({ type: "int", default: 5 })
  maxBids!: number;

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  budgetMin?: number;

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  budgetMax?: number;

  @Column({ type: "varchar", nullable: true })
  address?: string;

  @Column({ type: "varchar", nullable: true })
  area?: string;

  /** City for facets / soft distance ranking (e.g. Bengaluru). */
  @Column({ type: "varchar", nullable: true })
  city?: string;

  @Column({ type: "varchar", nullable: true })
  pincode?: string;

  /** Optional approximate coords for soft ranking (no geo libs). */
  @Column({ type: "float", nullable: true })
  lat?: number;

  @Column({ type: "float", nullable: true })
  lng?: number;

  @Column({ type: "jsonb", default: [] })
  photoUrls!: string[];

  /** Problem / site photos taken before or during work (completion gallery). */
  @Column({ type: "jsonb", default: [] })
  beforePhotoUrls!: string[];

  /** Result photos after work is done. */
  @Column({ type: "jsonb", default: [] })
  afterPhotoUrls!: string[];

  @Column({ type: "enum", enum: JobStatus, default: JobStatus.OPEN })
  status!: JobStatus;

  @Column({
    type: "enum",
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  paymentStatus!: PaymentStatus;

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  escrowAmount?: number;

  /** How escrow was funded on accept: structured quote vs bid amount. */
  @Column({ type: "varchar", length: 16, nullable: true })
  escrowSource?: "quote" | "bid" | null;

  @Column({
    type: "enum",
    enum: ScheduleStatus,
    default: ScheduleStatus.NONE,
  })
  scheduleStatus!: ScheduleStatus;

  @Column({ type: "timestamptz", nullable: true })
  scheduledStart?: Date;

  @Column({ type: "timestamptz", nullable: true })
  scheduledEnd?: Date;

  @Column({ type: "uuid", nullable: true })
  scheduleProposedByUserId?: string;

  @Column({ type: "text", nullable: true })
  scheduleNote?: string;

  @Column({ type: "uuid" })
  homeownerId!: string;

  @ManyToOne(() => User, (user) => user.jobs, { onDelete: "CASCADE" })
  @JoinColumn({ name: "homeownerId" })
  homeowner!: User;

  @Column({ type: "uuid", nullable: true })
  acceptedBidId?: string;

  @OneToOne(() => Bid, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "acceptedBidId" })
  acceptedBid?: Bid;

  @OneToMany(() => Bid, (bid) => bid.job)
  bids!: Bid[];

  @OneToMany(() => Dispute, (dispute) => dispute.job)
  disputes!: Dispute[];

  @OneToMany(() => PaymentMilestone, (m) => m.job)
  milestones!: PaymentMilestone[];

  @Column({ type: "timestamptz", nullable: true })
  completedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
