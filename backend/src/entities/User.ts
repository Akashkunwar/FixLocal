import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { TradespersonProfile } from "./TradespersonProfile";
import { Job } from "./Job";
import { Bid } from "./Bid";

export enum UserRole {
  ADMIN = "ADMIN",
  HOMEOWNER = "HOMEOWNER",
  TRADESPERSON = "TRADESPERSON",
}

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", unique: true })
  email!: string;

  @Column({ type: "varchar" })
  passwordHash!: string;

  @Column({ type: "enum", enum: UserRole })
  role!: UserRole;

  @OneToOne(() => TradespersonProfile, (profile) => profile.user)
  tradespersonProfile?: TradespersonProfile;

  @OneToMany(() => Job, (job) => job.homeowner)
  jobs!: Job[];

  @OneToMany(() => Bid, (bid) => bid.tradesperson)
  bids!: Bid[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
