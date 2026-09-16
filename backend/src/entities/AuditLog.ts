import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export enum AuditAction {
  USER_SUSPEND = "user_suspend",
  USER_UNSUSPEND = "user_unsuspend",
  DISPUTE_RESOLVE = "dispute_resolve",
  FORCE_CANCEL = "force_cancel",
  VERIFY_TRADESPERSON = "verify_tradesperson",
  ADMIN_NOTE = "admin_note",
  MATCH_WEIGHTS_UPDATE = "match_weights_update",
  BEST_VALUE_BLEND_UPDATE = "best_value_blend_update",
}

@Entity("audit_logs")
@Index(["createdAt"])
@Index(["action"])
export class AuditLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  actorUserId!: string;

  @Column({ type: "varchar", nullable: true })
  actorEmail?: string;

  @Column({ type: "enum", enum: AuditAction })
  action!: AuditAction;

  @Column({ type: "varchar", nullable: true })
  targetType?: string;

  @Column({ type: "uuid", nullable: true })
  targetId?: string;

  @Column({ type: "text", nullable: true })
  summary?: string;

  @Column({ type: "jsonb", nullable: true })
  meta?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;
}
