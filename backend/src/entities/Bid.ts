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

  @Column({ type: "enum", enum: BidStatus, default: BidStatus.ACTIVE })
  status!: BidStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
