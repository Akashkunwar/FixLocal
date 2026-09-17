import { DataSource } from "typeorm";
import fs from "fs";
import { Baseline1790000000001 } from "../src/migrations/1790000000001-Baseline";
import { AuditHardening1790000000002 } from "../src/migrations/1790000000002-AuditHardening";

/** Fresh schema for the whole run: drop everything, then apply every migration. */
export default async function setup() {
  const ds = new DataSource({
    type: "postgres",
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    username: process.env.DB_USERNAME || "fixlocal",
    password: process.env.DB_PASSWORD || "fixlocal",
    database: process.env.TEST_DB_NAME || "fixlocal_test",
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
