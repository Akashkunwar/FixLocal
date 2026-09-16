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

  @Column({ type: "varchar" })
  passwordHash!: string;

  @Column({ type: "enum", enum: UserRole })
  role!: UserRole;

  @Column({ type: "varchar", nullable: true })
  name?: string;

  @Column({ type: "varchar", nullable: true })
  phone?: string;

  @Column({ type: "varchar", nullable: true })
  avatarUrl?: string;

  @Column({ type: "boolean", default: false })
  isSuspended!: boolean;

  /** Per-category in-app notification toggles; missing keys default to true. */
  @Column({ type: "jsonb", nullable: true })
  notificationPrefs?: Record<string, boolean> | null;

  /** Saved invite message templates for homeowners (id/label/body). */
  @Column({ type: "jsonb", nullable: true })
  inviteTemplates?: { id: string; label: string; body: string; createdAt?: string }[] | null;

  /** Pro counter-offer reply templates (busy / materials / floor price). */
  @Column({ type: "jsonb", nullable: true })
  counterTemplates?: { id: string; label: string; body: string; createdAt?: string }[] | null;

  /** Homeowner counter-offer / request-revise note templates. */
  @Column({ type: "jsonb", nullable: true })
  homeownerCounterTemplates?: { id: string; label: string; body: string; createdAt?: string }[] | null;

  /** Pro intro / first-message templates for in-job chat. */
  @Column({ type: "jsonb", nullable: true })
  introTemplates?: { id: string; label: string; body: string; createdAt?: string }[] | null;

  /**
   * Named client job templates library (from past completed jobs).
   * Shape: { id, name, title, description, category, siteType?, cadence?, ... }
   */
  @Column({ type: "jsonb", nullable: true })
  namedJobTemplates?: {
    id: string;
    name: string;
    title: string;
    description?: string;
    category?: string;
    siteType?: string;
    cadence?: string;
    cadenceNote?: string;
    budgetMin?: string;
    budgetMax?: string;
    address?: string;
    city?: string;
    area?: string;
    pincode?: string;
    lat?: string;
    lng?: string;
    sourceJobId?: string;
    createdAt?: string;
  }[] | null;

  /** Hours before "viewed but no reply" nudge (null = env/default 4). */
  @Column({ type: "int", nullable: true })
  quoteViewNudgeHours?: number | null;

  @OneToOne(() => TradespersonProfile, (profile) => profile.user)
  tradespersonProfile?: TradespersonProfile;

  @OneToMany(() => Job, (job) => job.homeowner)
  jobs!: Job[];

  @OneToMany(() => Bid, (bid) => bid.tradesperson)
  bids!: Bid[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
