import "reflect-metadata";
import "dotenv/config";
import path from "path";
import { DataSource } from "typeorm";
import { ALL_ENTITIES } from "./entities";

// Schema changes go through migrations only; never enable synchronize against a real database.
export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  username: process.env.DB_USERNAME || "fixlocal",
  password: process.env.DB_PASSWORD || "fixlocal",
  database: process.env.DB_NAME || "fixlocal",
  synchronize: false,
  migrationsRun: false,
  logging: process.env.DB_LOGGING === "true",
  entities: ALL_ENTITIES,
  migrations: [path.join(__dirname, "migrations", "*.{ts,js}")],
  migrationsTableName: "migrations",
});

