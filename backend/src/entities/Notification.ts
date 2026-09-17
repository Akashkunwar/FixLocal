import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "./User";

export enum NotificationType {
  NEW_BID = "new_bid",
  BID_ACCEPTED = "bid_accepted",
  BID_REJECTED = "bid_rejected",
  JOB_STATUS = "job_status",
  DISPUTE = "dispute",
  MESSAGE = "message",
  REVIEW = "review",
  SYSTEM = "system",
  /** Favorited pro availability / matching job heuristics */
  PRO_AVAILABLE = "pro_available",
  MATCH = "match",
}

@Entity("notifications")
@Index(["userId", "read", "createdAt"])
export class Notification {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ type: "enum", enum: NotificationType })
  type!: NotificationType;

  @Column({ type: "varchar" })
  title!: string;

  @Column({ type: "text" })
  body!: string;

  @Column({ type: "varchar", nullable: true })
  link?: string;

  @Column({ type: "boolean", default: false })
  read!: boolean;

  @Column({ type: "jsonb", nullable: true })
  meta?: Record<string, unknown>;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
