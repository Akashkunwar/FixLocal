import "reflect-metadata";
import { DataSource } from "typeorm";
import {
  User,
  TradespersonProfile,
  Job,
  Bid,
  Dispute,
  Review,
  Message,
  Notification,
  Favorite,
  PaymentMilestone,
  AuditLog,
  AppConfig,
} from "./entities";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  username: process.env.DB_USERNAME || "fixlocal",
  password: process.env.DB_PASSWORD || "fixlocal",
  database: process.env.DB_NAME || "fixlocal",
  synchronize: process.env.NODE_ENV !== "production",
  logging: process.env.NODE_ENV === "development",
  entities: [
    User,
    TradespersonProfile,
    Job,
    Bid,
    Dispute,
    Review,
    Message,
    Notification,
    Favorite,
    PaymentMilestone,
    AuditLog,
    AppConfig,
  ],
});
