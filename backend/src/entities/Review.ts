import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Job } from "./Job";
import { User } from "./User";

export enum ReviewDirection {
  CLIENT_TO_PRO = "client_to_pro",
  PRO_TO_CLIENT = "pro_to_client",
}

@Entity("reviews")
@Index("UQ_review_job_direction", ["jobId", "direction"], { unique: true })
@Index(["tradespersonId"])
@Index(["revieweeId"])
@Check("CHK_review_rating", `"rating" >= 1 AND "rating" <= 5`)
export class Review {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  jobId!: string;

  @ManyToOne(() => Job, { onDelete: "CASCADE" })
  @JoinColumn({ name: "jobId" })
  job!: Job;

  @Column({ type: "varchar", length: 16, default: ReviewDirection.CLIENT_TO_PRO })
  direction!: ReviewDirection;

  @Column({ type: "uuid" })
  reviewerId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "reviewerId" })
  reviewer!: User;

  /** The user being reviewed (the pro for client_to_pro, the client for pro_to_client). */
  @Column({ type: "uuid" })
  revieweeId!: string;

  /** The awarded professional on the job (kept for pro rating aggregation). */
  @Column({ type: "uuid" })
  tradespersonId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "tradespersonId" })
  tradesperson!: User;

  @Column({ type: "int" })
  rating!: number;

  @Column({ type: "text", nullable: true })
  comment?: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
