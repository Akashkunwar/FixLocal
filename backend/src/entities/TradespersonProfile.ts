import { numeric } from "../db/numeric";
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { User } from "./User";

export enum VerificationStatus {
  PENDING = "pending",
  VERIFIED = "verified",
  REJECTED = "rejected",
  SUSPENDED = "suspended",
}

@Entity("tradesperson_profiles")
@Check("CHK_profile_lat", `"lat" IS NULL OR ("lat" >= -90 AND "lat" <= 90)`)
@Check("CHK_profile_lng", `"lng" IS NULL OR ("lng" >= -180 AND "lng" <= 180)`)
@Check("CHK_profile_rates", `("hourlyRateMin" IS NULL OR "hourlyRateMin" >= 0) AND ("hourlyRateMax" IS NULL OR "hourlyRateMax" >= 0)`)
@Check("CHK_profile_years", `"yearsExperience" IS NULL OR ("yearsExperience" >= 0 AND "yearsExperience" <= 80)`)
export class TradespersonProfile {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid", unique: true })
  userId!: string;

  @OneToOne(() => User, (user) => user.tradespersonProfile, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ type: "text", nullable: true })
  skills?: string;

  @Column({ type: "text", nullable: true })
  serviceAreas?: string;

  @Column({ type: "text", nullable: true })
  bio?: string;

  @Column({ type: "int", nullable: true })
  yearsExperience?: number;

  @Column({ type: "decimal", precision: 10, scale: 2, transformer: numeric, nullable: true })
  hourlyRateMin?: number;

  @Column({ type: "decimal", precision: 10, scale: 2, transformer: numeric, nullable: true })
  hourlyRateMax?: number;

  @Column({ type: "varchar", nullable: true })
  city?: string;

  @Column({ type: "float", nullable: true })
  lat?: number;

  @Column({ type: "float", nullable: true })
  lng?: number;

  @Column({ type: "jsonb", default: [] })
  galleryUrls!: string[];

  /**
   * Simple weekly availability slots.
   * Shape: { mon: { enabled, start, end }, ... } with HH:mm times (local).
   */
  @Column({ type: "jsonb", nullable: true })
  weeklyAvailability?: Record<
    string,
    {
      enabled: boolean;
      start: string;
      end: string;
      /** Optional extra windows same day (HH:mm). Primary start/end kept for compat. */
      slots?: { start: string; end: string }[];
    }
  > | null;

  /** ISO dates YYYY-MM-DD the pro is fully unavailable. */
  @Column({ type: "jsonb", default: [] })
  blockedDates!: string[];

  /** Job categories the pro prefers not to be invited for (soft-skip in suggestions). */
  @Column({ type: "jsonb", default: [] })
  notInterestedCategories!: string[];

  /**
   * Editable custom rate packages (beyond soft hourly estimates).
   * Shape: { id, label, hint?, amountMin, amountMax?, unit? }
   */
  @Column({ type: "jsonb", default: [] })
  customRatePackages!: {
    id: string;
    label: string;
    hint?: string;
    amountMin: number;
    amountMax?: number | null;
    unit?: string | null;
  }[];

  /**
   * Past-work case studies for portfolio / public profile.
   * Shape: { id, title, notes?, beforeUrl?, afterUrl?, category? }
   */
  @Column({ type: "jsonb", default: [] })
  caseStudies!: {
    id: string;
    title: string;
    notes?: string;
    beforeUrl?: string | null;
    afterUrl?: string | null;
    category?: string | null;
  }[];

  @Column({ type: "decimal", precision: 3, scale: 2, transformer: numeric, default: 0 })
  averageRating!: number;

  @Column({ type: "int", default: 0 })
  reviewCount!: number;

  @Column({
    type: "enum",
    enum: VerificationStatus,
    default: VerificationStatus.PENDING,
  })
  verificationStatus!: VerificationStatus;

  /** Upload reference of kind "license" (private: owner + admins). */
  @Column({ type: "varchar", nullable: true })
  licenseDocUrl?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  verifiedAt?: Date;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
