import "reflect-metadata";
import type { Server } from "http";
import { config } from "./config";
import { logger } from "./logger";
import { AppDataSource } from "./data-source";
import { closeCache, initCache } from "./utils/cache";
import { closeAllStreams, initSseFanout } from "./utils/sse";
import { initConfigInvalidation } from "./utils/matchWeights";
import { ensureUploadDirs } from "./services/files";
import { startWorkers, stopWorkers } from "./workers";
import { createApp } from "./app";

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
});

async function start() {
  const cfg = config();
  await AppDataSource.initialize();
  const pending = await AppDataSource.showMigrations();
  if (pending) {
    if (process.env.MIGRATIONS_RUN === "true") {
      await AppDataSource.runMigrations({ transaction: "each" });
      logger.info("Database migrations applied");
    } else {
      throw new Error("Database has pending migrations. Run `npm run db:migrate` (or set MIGRATIONS_RUN=true).");
    }
  }
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
    stopWorkers();
    closeAllStreams();
    server.close(async () => {
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
