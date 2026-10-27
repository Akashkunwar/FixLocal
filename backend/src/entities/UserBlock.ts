import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** blockerId no longer wants contact with blockedId: no bids, invites or messages between them. */
@Entity("user_blocks")
@Index("UQ_user_block_pair", ["blockerId", "blockedId"], { unique: true })
@Index(["blockedId"])
export class UserBlock {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  blockerId!: string;

  @Column({ type: "uuid" })
  blockedId!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
