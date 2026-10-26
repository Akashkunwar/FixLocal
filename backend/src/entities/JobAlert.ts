import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { User } from "./User";

/**
 * A professional's standing search: "tell me when a job like this is posted".
 * Matched against every new open job (see utils/jobAlerts.ts).
 */
@Entity("job_alerts")
@Index(["userId"])
@Index(["active"])
export class JobAlert {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ type: "varchar", length: 80 })
  name!: string;

  /** Job categories to match; empty means any category. */
  @Column({ type: "jsonb", default: () => "'[]'" })
  categories!: string[];

  @Column({ type: "varchar", length: 80, nullable: true })
  city?: string | null;

  @Column({ type: "varchar", length: 120, nullable: true })
  area?: string | null;

  /** Centre and radius for distance matching (jobs with a map pin). */
  @Column({ type: "double precision", nullable: true })
  lat?: number | null;

  @Column({ type: "double precision", nullable: true })
  lng?: number | null;

  @Column({ type: "int", nullable: true })
  radiusKm?: number | null;

  /** Only jobs whose budget can reach this amount (₹). */
  @Column({ type: "int", nullable: true })
  minBudget?: number | null;

  @Column({ type: "varchar", length: 16, nullable: true })
  siteType?: string | null;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @Column({ type: "int", default: 0 })
  matchCount!: number;

  @Column({ type: "timestamptz", nullable: true })
  lastMatchedAt?: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
