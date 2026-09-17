import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("idempotency_keys")
@Index("UQ_idempotency_user_key", ["userId", "key"], { unique: true })
@Index(["createdAt"])
export class IdempotencyKey {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "varchar", length: 128 })
  key!: string;

  @Column({ type: "varchar", length: 8 })
  method!: string;

  @Column({ type: "varchar", length: 255 })
  path!: string;

  /** Null while the first request is still in flight. */
  @Column({ type: "int", nullable: true })
  statusCode?: number | null;

  @Column({ type: "jsonb", nullable: true })
  responseBody?: unknown;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
