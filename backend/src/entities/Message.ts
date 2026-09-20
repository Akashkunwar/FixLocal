import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Job } from "./Job";
import { User } from "./User";

/**
 * Job chat is split into one thread per (job, professional):
 * the client talks to each bidding pro privately.
 */
@Entity("messages")
@Index(["jobId", "createdAt"])
@Index(["jobId", "threadTradespersonId", "createdAt"])
export class Message {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  jobId!: string;

  @ManyToOne(() => Job, { onDelete: "CASCADE" })
  @JoinColumn({ name: "jobId" })
  job!: Job;

  @Column({ type: "uuid" })
  threadTradespersonId!: string;

  @Column({ type: "uuid" })
  senderId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "senderId" })
  sender!: User;

  @Column({ type: "text", default: "" })
  body!: string;

  /** Upload references (/api/files/<name>) of kind "chat". */
  @Column({ type: "jsonb", default: [] })
  attachmentUrls!: string[];

  /** Optional structured quote/estimate shared in chat. */
  @Column({ type: "jsonb", nullable: true })
  quote?: {
    amount: number;
    notes?: string;
    attachmentUrl?: string;
  } | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
