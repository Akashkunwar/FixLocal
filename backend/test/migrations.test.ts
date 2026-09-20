import { describe, expect, it } from "vitest";
import { DataSource } from "typeorm";
import { ALL_ENTITIES } from "../src/entities";
import { Baseline1790000000001 } from "../src/migrations/1790000000001-Baseline";
import { AuditHardening1790000000002 } from "../src/migrations/1790000000002-AuditHardening";

const dbName = process.env.MIGRATION_TEST_DB || "fixlocal_migrate";

const connection = {
  type: "postgres" as const,
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  username: process.env.DB_USERNAME || "fixlocal",
  password: process.env.DB_PASSWORD || "fixlocal",
};

/** The test owns its database: create it on a fresh server (e.g. CI). */
async function ensureDatabase() {
  const admin = new DataSource({ ...connection, database: "postgres" });
  await admin.initialize();
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (!exists.length) await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.destroy();
  }
}

describe("migrations (H-9)", () => {
  it("run up, down and up again on an empty database, with no drift from the entities", async () => {
    await ensureDatabase();
    const ds = new DataSource({
      ...connection,
      database: dbName,
      entities: ALL_ENTITIES,
      migrations: [Baseline1790000000001, AuditHardening1790000000002],
    });
    await ds.initialize();
    try {
      await ds.query(`DROP SCHEMA public CASCADE`);
      await ds.query(`CREATE SCHEMA public`);
      await ds.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
      expect(await ds.runMigrations({ transaction: "each" })).toHaveLength(2);
      await ds.undoLastMigration({ transaction: "each" });
      await ds.undoLastMigration({ transaction: "each" });
      const tables = await ds.query(`SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'`);
      expect(tables[0].n).toBe(0);
      expect(await ds.runMigrations({ transaction: "each" })).toHaveLength(2);
      const drift = await ds.driver.createSchemaBuilder().log();
      expect(drift.upQueries.map((q) => q.query)).toEqual([]);
    } finally {
      await ds.destroy();
    }
  }, 120_000);
});
