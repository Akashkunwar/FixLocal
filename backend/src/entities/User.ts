import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { TradespersonProfile } from "./TradespersonProfile";
import { Job } from "./Job";
import { Bid } from "./Bid";

export enum UserRole {
  ADMIN = "ADMIN",
  HOMEOWNER = "HOMEOWNER",
  TRADESPERSON = "TRADESPERSON",
}

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", unique: true })
  email!: string;

  // Never selected by default; login and password changes select it explicitly.
  @Column({ type: "varchar", select: false })
  passwordHash!: string;

  @Column({ type: "enum", enum: UserRole })
  role!: UserRole;

  @Column({ type: "varchar", nullable: true })
  name?: string;

  @Column({ type: "varchar", nullable: true })
  phone?: string;

  /** Upload reference (/api/files/<name>) of kind "avatar". */
  @Column({ type: "varchar", nullable: true })
  avatarUrl?: string;

  @Column({ type: "boolean", default: false })
  isSuspended!: boolean;

  /** Bumped on suspend / password change to invalidate outstanding tokens. */
  @Column({ type: "int", default: 0 })
  tokenVersion!: number;

  @Column({ type: "timestamptz", nullable: true })
  emailVerifiedAt?: Date | null;

  @Column({ type: "varchar", length: 64, default: "Asia/Kolkata" })
  timezone!: string;

  /** Set when the account is deleted; personal data is anonymized at the same time. */
  @Column({ type: "timestamptz", nullable: true })
  deletedAt?: Date | null;

  /** Per-category in-app notification toggles; missing keys default to true. */
  @Column({ type: "jsonb", nullable: true })
  notificationPrefs?: Record<string, boolean> | null;

  /** Hours before "viewed but no reply" nudge (null = env/default 4). */
  @Column({ type: "int", nullable: true })
  quoteViewNudgeHours?: number | null;

  @OneToOne(() => TradespersonProfile, (profile) => profile.user)
  tradespersonProfile?: TradespersonProfile;

  @OneToMany(() => Job, (job) => job.homeowner)
  jobs!: Job[];

  @OneToMany(() => Bid, (bid) => bid.tradesperson)
  bids!: Bid[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
