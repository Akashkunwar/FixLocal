import "reflect-metadata";
import "dotenv/config";
import { AppDataSource } from "../data-source";

/**
 * One-time step for databases created by the old `synchronize` setting:
 * records the baseline migration as applied (the tables already exist),
 * so `npm run db:migrate` only runs the newer migrations.
 */
async function main() {
  await AppDataSource.initialize();
  const [{ has_users }] = await AppDataSource.query(`SELECT to_regclass('public.users') IS NOT NULL AS has_users`);
  const [{ has_migrations }] = await AppDataSource.query(
    `SELECT to_regclass('public.migrations') IS NOT NULL AS has_migrations`
  );
  if (!has_users) {
    console.log("Empty database: nothing to baseline. Run `npm run db:migrate`.");
    return AppDataSource.destroy();
  }
  if (!has_migrations) {
    await AppDataSource.query(
      `CREATE TABLE "migrations" ("id" SERIAL PRIMARY KEY, "timestamp" bigint NOT NULL, "name" character varying NOT NULL)`
    );
  }
  const done = await AppDataSource.query(`SELECT 1 FROM "migrations" WHERE "name" = 'Baseline1790000000001'`);
  if (done.length) {
    console.log("Baseline already recorded.");
  } else {
    await AppDataSource.query(
      `INSERT INTO "migrations" ("timestamp", "name") VALUES (1790000000001, 'Baseline1790000000001')`
    );
    console.log("Baseline recorded. Now run `npm run db:migrate`.");
  }
  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
