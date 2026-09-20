import "reflect-metadata";
import crypto from "crypto";
import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { config } from "./config";
import { logger } from "./logger";
import { AppDataSource } from "./data-source";
import { cacheReady } from "./utils/cache";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { serveFile } from "./controllers/fileController";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import jobRoutes from "./routes/jobs";
import bidRoutes from "./routes/bids";
import disputeRoutes from "./routes/disputes";
import profileRoutes from "./routes/profile";
import reviewRoutes from "./routes/reviews";
import messageRoutes from "./routes/messages";
import notificationRoutes from "./routes/notifications";
import favoriteRoutes from "./routes/favorites";
import reportRoutes from "./routes/reports";
import fileRoutes from "./routes/files";
import { consoleMailer } from "./services/mailer";

export function createApp(): Express {
  const cfg = config();
  const app = express();
  app.disable("x-powered-by");
  if (cfg.trustProxy) app.set("trust proxy", 1);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"];
        const id = typeof incoming === "string" && incoming.length <= 64 ? incoming : crypto.randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === "/health" },
    })
  );
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: "same-site" },
    })
  );
  const allowed = new Set(cfg.corsOrigins);
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowed.has(origin) ? origin || false : false),
      credentials: true,
      exposedHeaders: ["X-Request-Id", "RateLimit", "RateLimit-Policy", "Retry-After"],
    })
  );
  app.use(express.json({ limit: "200kb" }));
  const inspector = (globalThis as Record<string, unknown>).__FIXLOCAL_JSON_INSPECTOR__ as
    | ((url: string, body: unknown) => void)
    | undefined;
  if (inspector && cfg.isTest) {
    app.use((req, res, next) => {
      const json = res.json.bind(res);
      res.json = (body: unknown) => {
        inspector(req.originalUrl, body);
        return json(body);
      };
      next();
    });
  }
  app.use(cookieParser());

  app.get("/health", async (_req, res) => {
    let db = "down";
    try {
      await AppDataSource.query("SELECT 1");
      db = "up";
    } catch {
      /* reported below */
    }
    const ok = db === "up";
    res.status(ok ? 200 : 503).json({
      status: ok ? "ok" : "degraded",
      service: "fixlocal-backend",
      db,
      redis: cfg.redisEnabled ? (cacheReady() ? "connected" : "unavailable") : "disabled",
    });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/jobs", jobRoutes);
  app.use("/api/bids", bidRoutes);
  app.use("/api/disputes", disputeRoutes);
  app.use("/api/profile", profileRoutes);
  app.use("/api/reviews", reviewRoutes);
  app.use("/api/messages", messageRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/favorites", favoriteRoutes);
  app.use("/api/reports", reportRoutes);
  app.use("/api/files", fileRoutes);
  // Old links (/uploads/<name>) go through the same access checks.
  app.get("/uploads/:name", serveFile);

  if (!cfg.isProd && process.env.DEV_OUTBOX === "true") {
    app.get("/api/dev/outbox", (_req, res) => {
      res.json({ emails: consoleMailer.outbox });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
