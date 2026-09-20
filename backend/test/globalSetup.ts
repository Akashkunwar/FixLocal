import { DataSource } from "typeorm";
import fs from "fs";
import { Baseline1790000000001 } from "../src/migrations/1790000000001-Baseline";
import { AuditHardening1790000000002 } from "../src/migrations/1790000000002-AuditHardening";

/** Fresh schema for the whole run: drop everything, then apply every migration. */
export default async function setup() {
  const connection = {
    type: "postgres" as const,
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    username: process.env.DB_USERNAME || "fixlocal",
    password: process.env.DB_PASSWORD || "fixlocal",
  };
  const dbName = process.env.TEST_DB_NAME || "fixlocal_test";
  if (!/test/.test(dbName)) throw new Error(`Refusing to reset non-test database "${dbName}"`);
  const admin = new DataSource({ ...connection, database: "postgres" });
  await admin.initialize();
  if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName])).length) {
    await admin.query(`CREATE DATABASE "${dbName}"`);
  }
  await admin.destroy();

  const ds = new DataSource({
    ...connection,
    database: dbName,
    migrations: [Baseline1790000000001, AuditHardening1790000000002],
  });
  await ds.initialize();
  if (!/test/.test(ds.options.database as string)) {
    throw new Error(`Refusing to reset non-test database "${ds.options.database}"`);
  }
  await ds.query(`DROP SCHEMA public CASCADE`);
  await ds.query(`CREATE SCHEMA public`);
  await ds.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await ds.runMigrations({ transaction: "each" });
  await ds.destroy();

  return async () => {
    const dir = process.env.UPLOADS_DIR;
    if (dir && dir.includes("fixlocal-test-uploads")) fs.rmSync(dir, { recursive: true, force: true });
  };
}
