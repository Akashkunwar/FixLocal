import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export type ReportTargetType = "job" | "user" | "message";
export type ReportStatus = "open" | "resolved" | "dismissed";

@Entity("reports")
@Index(["status", "createdAt"])
export class Report {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  reporterId!: string;

  @Column({ type: "varchar", length: 16 })
  targetType!: ReportTargetType;

  @Column({ type: "uuid" })
  targetId!: string;

  @Column({ type: "text" })
  reason!: string;

  @Column({ type: "varchar", length: 16, default: "open" })
  status!: ReportStatus;

  @Column({ type: "text", nullable: true })
  resolutionNote?: string | null;

  @Column({ type: "uuid", nullable: true })
  resolvedByUserId?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  resolvedAt?: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
