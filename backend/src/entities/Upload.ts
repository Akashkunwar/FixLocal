import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export enum UploadKind {
  JOB_PHOTO = "job_photo",
  COMPLETION = "completion",
  EVIDENCE = "evidence",
  CHAT = "chat",
  QUOTE = "quote",
  GALLERY = "gallery",
  CASE_STUDY = "case_study",
  LICENSE = "license",
  AVATAR = "avatar",
}

/** Every stored file has a row; access is decided from kind + ownership. */
@Entity("uploads")
@Index(["jobId"])
@Index(["ownerUserId"])
export class Upload {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** File name on disk and in URLs: <uuid>.<ext> (legacy files keep their old names). */
  @Column({ type: "varchar", length: 255, unique: true })
  name!: string;

  @Column({ type: "uuid" })
  ownerUserId!: string;

  @Column({ type: "varchar", length: 24 })
  kind!: UploadKind;

  @Column({ type: "uuid", nullable: true })
  jobId?: string | null;

  @Column({ type: "uuid", nullable: true })
  threadTradespersonId?: string | null;

  @Column({ type: "uuid", nullable: true })
  bidId?: string | null;

  @Column({ type: "varchar", length: 64 })
  mime!: string;

  @Column({ type: "int", default: 0 })
  size!: number;

  @Column({ type: "varchar", length: 255, nullable: true })
  originalName?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
