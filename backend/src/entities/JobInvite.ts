import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { Job } from "./Job";
import { User } from "./User";

export type InviteStatus = "pending" | "declined";

@Entity("job_invites")
@Index("UQ_invite_job_pro", ["jobId", "tradespersonId"], { unique: true })
@Index(["tradespersonId", "createdAt"])
export class JobInvite {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  jobId!: string;

  @ManyToOne(() => Job, { onDelete: "CASCADE" })
  @JoinColumn({ name: "jobId" })
  job!: Job;

  @Column({ type: "uuid" })
  tradespersonId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "tradespersonId" })
  tradesperson!: User;

  @Column({ type: "uuid" })
  invitedByUserId!: string;

  @Column({ type: "text", nullable: true })
  message?: string | null;

  @Column({ type: "varchar", length: 16, default: "suggested" })
  source!: string;

  @Column({ type: "int", nullable: true })
  shortlistRank?: number | null;

  @Column({ type: "float", nullable: true })
  smartScore?: number | null;

  @Column({ type: "varchar", length: 16, default: "pending" })
  status!: InviteStatus;

  /** Total times this pro was invited to this job (re-invites after a decline). */
  @Column({ type: "int", default: 1 })
  inviteCount!: number;

  @Column({ type: "timestamptz" })
  lastInvitedAt!: Date;

  @Column({ type: "varchar", length: 32, nullable: true })
  declineReason?: string | null;

  @Column({ type: "text", nullable: true })
  declineNote?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  declinedAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  openedAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  clickedAt?: Date | null;

  @Column({ type: "uuid", nullable: true })
  notificationId?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
