import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { User } from "./User";

@Entity("refresh_tokens")
@Index(["userId"])
@Index(["familyId"])
export class RefreshToken {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  /** sha256 of the opaque token; the raw value only ever lives in the cookie. */
  @Column({ type: "varchar", length: 64, unique: true })
  tokenHash!: string;

  @Column({ type: "uuid" })
  familyId!: string;

  @Column({ type: "timestamptz" })
  expiresAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  revokedAt?: Date | null;

  @Column({ type: "uuid", nullable: true })
  replacedById?: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  userAgent?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
