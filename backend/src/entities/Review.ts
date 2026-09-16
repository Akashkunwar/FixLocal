import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { Job } from "./Job";
import { User } from "./User";

@Entity("reviews")
@Unique(["jobId"])
@Index(["tradespersonId"])
export class Review {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  jobId!: string;

  @ManyToOne(() => Job, { onDelete: "CASCADE" })
  @JoinColumn({ name: "jobId" })
  job!: Job;

  @Column({ type: "uuid" })
  reviewerId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "reviewerId" })
  reviewer!: User;

  @Column({ type: "uuid" })
  tradespersonId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "tradespersonId" })
  tradesperson!: User;

  @Column({ type: "int" })
  rating!: number;

  @Column({ type: "text", nullable: true })
  comment?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
