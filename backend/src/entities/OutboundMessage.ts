import { Column, CreateDateColumn, UpdateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { User } from "./User";

export const OUTBOUND_STATUSES = ["queued", "sending", "sent", "failed", "skipped"] as const;
export type OutboundStatus = (typeof OUTBOUND_STATUSES)[number];

/**
 * SMS / WhatsApp queue. Rows wait here until `sendAfter` (quiet hours push it to 8 AM IST);
 * the worker claims them with SKIP LOCKED, so several API instances never double-send.
 */
@Entity("outbound_messages")
@Index(["status", "sendAfter"])
@Index(["userId", "createdAt"])
export class OutboundMessage {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ type: "varchar", length: 10 })
  channel!: "sms" | "whatsapp";

  @Column({ type: "varchar", length: 400 })
  body!: string;

  @Column({ type: "varchar", length: 10, default: "queued" })
  status!: OutboundStatus;

  @Column({ type: "timestamptz" })
  sendAfter!: Date;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  /** One message per notification and channel. */
  @Column({ type: "varchar", length: 120, unique: true })
  dedupeKey!: string;

  @Column({ type: "varchar", length: 120, nullable: true })
  providerRef?: string | null;

  @Column({ type: "varchar", length: 300, nullable: true })
  lastError?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  sentAt?: Date | null;
}
