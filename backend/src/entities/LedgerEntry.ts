import { numeric } from "../db/numeric";
import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export enum LedgerType {
  HOLD = "hold",
  RELEASE = "release",
  REFUND = "refund",
}

/** Append-only record of simulated escrow movements. Earnings and GMV derive from it. */
@Entity("ledger_entries")
@Index(["jobId", "createdAt"])
@Index(["payeeUserId", "type"])
@Check("CHK_ledger_amount", `"amount" >= 0`)
export class LedgerEntry {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  jobId!: string;

  @Column({ type: "uuid", nullable: true })
  milestoneId?: string | null;

  @Column({ type: "varchar", length: 16 })
  type!: LedgerType;

  @Column({ type: "decimal", precision: 12, scale: 2, transformer: numeric })
  amount!: number;

  /** Professional who receives released funds. */
  @Column({ type: "uuid", nullable: true })
  payeeUserId?: string | null;

  /** Client who funded the escrow. */
  @Column({ type: "uuid", nullable: true })
  payerUserId?: string | null;

  @Column({ type: "uuid", nullable: true })
  actorUserId?: string | null;

  @Column({ type: "text", nullable: true })
  note?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
