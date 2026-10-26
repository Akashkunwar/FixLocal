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

  /** When the user accepted the Terms of Service / Privacy Policy, and which version. */
  /** Set when the user proves they own `phone` with a one-time code; cleared if the number changes. */
  @Column({ type: "timestamptz", nullable: true })
  phoneVerifiedAt?: Date | null;

  /** Opted in to SMS / WhatsApp for key events (needs a verified phone). */
  @Column({ type: "boolean", default: false })
  smsOptIn!: boolean;

  @Column({ type: "boolean", default: false })
  whatsappOptIn!: boolean;

  @Column({ type: "varchar", length: 64, nullable: true, select: false })
  phoneCodeHash?: string | null;

  @Column({ type: "timestamptz", nullable: true, select: false })
  phoneCodeExpiresAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true, select: false })
  phoneCodeSentAt?: Date | null;

  @Column({ type: "int", default: 0, select: false })
  phoneCodeAttempts!: number;

  /** Keyed hash of the sign-up IP + browser, compared only to spot self-referrals. Never exported. */
  @Column({ type: "varchar", length: 64, nullable: true, select: false })
  signupDeviceHash?: string | null;

  /** Interface and email language ("en" or "hi"); synced across the user's devices. */
  @Column({ type: "varchar", length: 5, default: "en" })
  language!: string;

  @Column({ type: "timestamptz", nullable: true })
  termsAcceptedAt?: Date | null;

  @Column({ type: "varchar", length: 16, nullable: true })
  termsVersion?: string | null;

  /** Personal invite code (created the first time the user opens "Invite friends"). */
  @Column({ type: "varchar", length: 12, nullable: true, unique: true })
  referralCode?: string | null;

  /** Who invited this user (set at sign-up from ?ref=CODE). */
  @Index()
  @Column({ type: "uuid", nullable: true })
  referredById?: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "referredById" })
  referredBy?: User | null;

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
