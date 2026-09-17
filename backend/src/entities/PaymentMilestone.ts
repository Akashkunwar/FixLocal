import { numeric } from "../db/numeric";
import {
  Check,
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

export enum MilestoneStatus {
  PENDING = "pending",
  HELD = "held",
  RELEASED = "released",
  REFUNDED = "refunded",
}

@Entity("payment_milestones")
@Index(["jobId"])
@Index("UQ_milestone_job_sequence", ["jobId", "sequence"], { unique: true })
@Check("CHK_milestone_amount", `"amount" >= 0`)
export class PaymentMilestone {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  jobId!: string;

  @ManyToOne(() => Job, (job) => job.milestones, { onDelete: "CASCADE" })
  @JoinColumn({ name: "jobId" })
  job!: Job;

  @Column({ type: "varchar" })
  label!: string;

  @Column({ type: "int" })
  sequence!: number;

  @Column({ type: "decimal", precision: 10, scale: 2, transformer: numeric })
  amount!: number;

  @Column({ type: "int" })
  percent!: number;

  @Column({
    type: "enum",
    enum: MilestoneStatus,
    default: MilestoneStatus.PENDING,
  })
  status!: MilestoneStatus;

  @Column({ type: "timestamptz", nullable: true })
  releasedAt?: Date;

  @Column({ type: "uuid", nullable: true })
  releasedByUserId?: string;

  @Column({ type: "timestamptz", nullable: true })
  refundedAt?: Date;

  @Column({ type: "uuid", nullable: true })
  refundedByUserId?: string;

  @Column({ type: "text", nullable: true })
  refundNote?: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
