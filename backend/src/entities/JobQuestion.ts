import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Job } from "./Job";
import { User } from "./User";

/**
 * Public Q&A on an open job: a verified professional asks before bidding, the client answers, and
 * every professional who can see the listing reads both (askers stay anonymous to other pros).
 */
@Entity("job_questions")
@Index(["jobId", "createdAt"])
export class JobQuestion {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  jobId!: string;

  @ManyToOne(() => Job, { onDelete: "CASCADE" })
  @JoinColumn({ name: "jobId" })
  job!: Job;

  /** Null once the asker's account is deleted. */
  @Column({ type: "uuid", nullable: true })
  askerId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "askerId" })
  asker?: User | null;

  @Column({ type: "varchar", length: 500 })
  question!: string;

  @Column({ type: "text", nullable: true })
  answer?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  answeredAt?: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
