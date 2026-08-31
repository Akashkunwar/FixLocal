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

export enum JobCategory {
  PLUMBING = "plumbing",
  ELECTRICAL = "electrical",
  CARPENTRY = "carpentry",
  PAINTING = "painting",
  APPLIANCE = "appliance",
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

/** Simulated payment only — no real gateway. */
export enum PaymentStatus {
  PENDING = "pending",
  SIMULATED_PAID = "simulated_paid",
}

@Entity("jobs")
@Index(["category"])
@Index(["status"])
@Index(["createdAt"])
@Index(["area"])
export class Job {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  title!: string;

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "enum", enum: JobCategory })
  category!: JobCategory;

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

  @Column({ type: "varchar", nullable: true })
  pincode?: string;

  @Column({ type: "jsonb", default: [] })
  photoUrls!: string[];

  @Column({ type: "enum", enum: JobStatus, default: JobStatus.OPEN })
  status!: JobStatus;

  @Column({
    type: "enum",
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  paymentStatus!: PaymentStatus;

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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
