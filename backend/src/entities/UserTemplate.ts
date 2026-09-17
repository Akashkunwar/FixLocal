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
import { User } from "./User";

export const TEMPLATE_KINDS = ["invite", "counter", "homeownerCounter", "intro", "namedJob"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/** Saved message / job templates (one row per template, ordered by position). */
@Entity("user_templates")
@Index(["userId", "kind", "position"])
export class UserTemplate {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ type: "varchar", length: 24 })
  kind!: TemplateKind;

  @Column({ type: "int", default: 0 })
  position!: number;

  /** The validated template object as the client sees it (including its client id). */
  @Column({ type: "jsonb" })
  data!: Record<string, unknown>;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
