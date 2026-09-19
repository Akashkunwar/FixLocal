/**
 * Recreate a throwaway database (end-to-end tests, CI): create it if missing, drop every
 * table, run all migrations, and flush its Redis database. Refuses anything whose name
 * doesn't end in _e2e or _test, so it can never touch the dev or production database.
 */
import "reflect-metadata";
import "dotenv/config";
import { DataSource } from "typeorm";
import { createClient } from "redis";
import { AppDataSource } from "../data-source";

const name = process.env.DB_NAME || "";

async function main() {
  if (!/_(e2e|test)$/.test(name)) {
    throw new Error(`Refusing to reset "${name}": DB_NAME must end in _e2e or _test`);
  }
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a database with NODE_ENV=production");

  const admin = new DataSource({
    type: "postgres",
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    username: process.env.DB_USERNAME || "fixlocal",
    password: process.env.DB_PASSWORD || "fixlocal",
    database: "postgres",
  });
  await admin.initialize();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (!exists.length) await admin.query(`CREATE DATABASE "${name}"`);
  await admin.destroy();

  await AppDataSource.initialize();
  await AppDataSource.query(`DROP SCHEMA public CASCADE`);
  await AppDataSource.query(`CREATE SCHEMA public`);
  await AppDataSource.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await AppDataSource.runMigrations({ transaction: "each" });
  await AppDataSource.destroy();

  if (process.env.REDIS_ENABLED !== "false" && process.env.REDIS_URL) {
    const redis = createClient({ url: process.env.REDIS_URL });
    await redis.connect();
    await redis.flushDb();
    await redis.quit();
  }
  console.log(`Reset ${name}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
