import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** Per-participant read position in a (job, professional) chat thread. */
@Entity("chat_thread_reads")
@Index("UQ_chat_read_participant", ["jobId", "threadTradespersonId", "userId"], { unique: true })
export class ChatThreadRead {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  jobId!: string;

  @Column({ type: "uuid" })
  threadTradespersonId!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "timestamptz" })
  lastReadAt!: Date;
}
