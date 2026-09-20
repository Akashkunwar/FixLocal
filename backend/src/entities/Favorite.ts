import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { User } from "./User";

export enum FavoriteTargetType {
  JOB = "job",
  PRO = "pro",
}

@Entity("favorites")
@Unique(["userId", "targetType", "targetId"])
@Index(["userId"])
export class Favorite {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ type: "enum", enum: FavoriteTargetType })
  targetType!: FavoriteTargetType;

  @Column({ type: "uuid" })
  targetId!: string;

  /** Homeowner shortlist note (pros). */
  @Column({ type: "text", nullable: true })
  notes?: string | null;

  /** Freeform shortlist tags, e.g. ["kitchen", "fast"]. */
  @Column({ type: "jsonb", nullable: true })
  tags?: string[] | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
