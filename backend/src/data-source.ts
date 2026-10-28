import "reflect-metadata";
import "./loadEnv";
import { DataSource } from "typeorm";
import { ALL_ENTITIES } from "./entities";
import { loadDbConfig } from "./config";
import { ALL_MIGRATIONS } from "./db/migrationList";

const db = loadDbConfig();

// Schema changes go through migrations only; never enable synchronize against a real database.
export const AppDataSource = new DataSource({
  type: "postgres",
  host: db.host,
  port: db.port,
  username: db.username,
  password: db.password,
  database: db.database,
  synchronize: false,
  migrationsRun: false,
  logging: db.logging,
  entities: ALL_ENTITIES,
  // The same explicit list the tests run (a parity test checks every file in migrations/ is in it).
  migrations: ALL_MIGRATIONS,
  migrationsTableName: "migrations",
});

