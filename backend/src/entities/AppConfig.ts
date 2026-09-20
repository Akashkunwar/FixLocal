import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

/** Simple key/value JSON config (admin-tunable). */
@Entity("app_configs")
export class AppConfig {
  @PrimaryColumn({ type: "varchar", length: 64 })
  key!: string;

  @Column({ type: "jsonb" })
  value!: Record<string, unknown>;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
