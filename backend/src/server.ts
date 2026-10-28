import "reflect-metadata";
import type { Server } from "http";
import { config, loadDbConfig } from "./config";
import { logger } from "./logger";
import { AppDataSource } from "./data-source";
import { closeCache, initCache } from "./utils/cache";
import { closeAllStreams, initSseFanout } from "./utils/sse";
import { initConfigInvalidation } from "./utils/matchWeights";
import { ensureUploadDirs } from "./services/files";
import { startWorkers, stopWorkers } from "./workers";
import { createApp } from "./app";
import { initErrorReporter, reportError } from "./services/errorReporter";

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
  reportError(reason, { where: "unhandledRejection" });
});
process.on("uncaughtException", (err) => {
  // State may be corrupt: log, report, and let the orchestrator restart the process.
  logger.fatal({ err }, "uncaught exception");
  reportError(err, { where: "uncaughtException" });
  setTimeout(() => process.exit(1), 500).unref();
});

/** Arbitrary constant for pg_advisory_lock: one API replica migrates at a time, the rest wait. */
const MIGRATION_LOCK_KEY = 7_340_021;

async function migrateIfAllowed() {
  if (!(await AppDataSource.showMigrations())) return;
  if (!loadDbConfig().migrationsRun) {
    throw new Error("Database has pending migrations. Run `npm run db:migrate` (or set MIGRATIONS_RUN=true).");
  }
  const runner = AppDataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    // Another replica may have finished them while this one waited for the lock.
    if (await AppDataSource.showMigrations()) {
      await AppDataSource.runMigrations({ transaction: "each" });
      logger.info("Database migrations applied");
    }
  } finally {
    await runner.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => undefined);
    await runner.release();
  }
}

async function start() {
  const cfg = config();
  initErrorReporter();
  if (cfg.isProd && cfg.mailProvider === "console") {
    logger.warn("MAIL_PROVIDER=console in production: verification and password-reset emails are NOT delivered");
  }
  await AppDataSource.initialize();
  await migrateIfAllowed();
  logger.info("Database connected");
  ensureUploadDirs();
  await initCache();
  await initSseFanout();
  await initConfigInvalidation();
  startWorkers();

  const app = createApp();
  const server: Server = app.listen(cfg.port, () => {
    logger.info(`FixLocal API listening on http://localhost:${cfg.port}`);
  });

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, "shutting down");
    const workersDone = stopWorkers().catch(() => undefined);
    closeAllStreams();
    server.close(async () => {
      await workersDone;
      await closeCache();
      await AppDataSource.destroy().catch(() => undefined);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((err) => {
  logger.fatal({ err }, "failed to start");
  process.exit(1);
});
