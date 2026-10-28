import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { User } from "./User";

export type EmailTokenType = "verify" | "reset";

export type PendingSignup = { passwordHash: string; role: string; name?: string | null; language?: "en" | "hi" };

@Entity("email_tokens")
@Index(["userId", "type"])
export class EmailToken {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ type: "varchar", length: 16 })
  type!: EmailTokenType;

  @Column({ type: "varchar", length: 64, unique: true })
  tokenHash!: string;

  @Column({ type: "timestamptz" })
  expiresAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  usedAt?: Date | null;

  /**
   * A repeat sign-up for an address that was never confirmed: the new password, role, name and
   * language, applied only when this link is used. Whoever controls the inbox decides which
   * sign-up wins, so an earlier sign-up by someone else can't keep its password (pre-account takeover).
   */
  @Column({ type: "jsonb", nullable: true })
  pending?: PendingSignup | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
