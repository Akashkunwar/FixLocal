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

@Entity("messages")
@Index(["jobId", "createdAt"])
export class Message {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  jobId!: string;

  @ManyToOne(() => Job, { onDelete: "CASCADE" })
  @JoinColumn({ name: "jobId" })
  job!: Job;

  @Column({ type: "uuid" })
  senderId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "senderId" })
  sender!: User;

  @Column({ type: "text", default: "" })
  body!: string;

  /** Chat image/PDF attachments (multer paths under /uploads). */
  @Column({ type: "jsonb", default: [] })
  attachmentUrls!: string[];

  /** Optional structured quote/estimate shared in chat. */
  @Column({ type: "jsonb", nullable: true })
  quote?: {
    amount: number;
    notes?: string;
    attachmentUrl?: string;
  } | null;

  @Column({ type: "timestamptz", nullable: true })
  readAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
