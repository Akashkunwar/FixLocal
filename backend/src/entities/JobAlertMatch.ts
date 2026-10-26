import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from "typeorm";
import { User } from "./User";
import { Job } from "./Job";
import { JobAlertDigest } from "./JobAlertDigest";

/** A job that matched a professional's daily-digest alert, waiting for the next digest. */
@Entity("job_alert_matches")
@Unique(["userId", "jobId"])
@Index(["digestId"])
@Index(["createdAt"])
export class JobAlertMatch {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ type: "uuid" })
  jobId!: string;

  @ManyToOne(() => Job, { onDelete: "CASCADE" })
  @JoinColumn({ name: "jobId" })
  job!: Job;

  /** Name of the alert that matched (kept as text so deleting the alert keeps the digest readable). */
  @Column({ type: "varchar", length: 80 })
  alertName!: string;

  /** Set once the match has gone out in a digest; a match is never sent twice. */
  @Column({ type: "uuid", nullable: true })
  digestId?: string | null;

  @ManyToOne(() => JobAlertDigest, { onDelete: "SET NULL" })
  @JoinColumn({ name: "digestId" })
  digest?: JobAlertDigest | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
