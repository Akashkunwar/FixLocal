import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from "typeorm";
import { User } from "./User";

/**
 * One row per professional per IST day. Claiming the row (unique userId + day) before sending is
 * what makes the daily digest idempotent: a second run, or a second API instance, finds it taken.
 */
@Entity("job_alert_digests")
@Unique(["userId", "digestDate"])
export class JobAlertDigest {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  /** The IST calendar day this digest covers (YYYY-MM-DD). */
  @Column({ type: "date" })
  digestDate!: string;

  @Column({ type: "int", default: 0 })
  jobCount!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
