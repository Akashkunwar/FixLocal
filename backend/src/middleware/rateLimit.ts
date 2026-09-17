import type { Request, RequestHandler } from "express";
import rateLimit, { ipKeyGenerator, type Store } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { config } from "../config";
import { redisClient } from "../utils/cache";

type LimitName = "login" | "loginHourly" | "register" | "refresh" | "passwordReset" | "messages" | "invites" | "uploads" | "reports";

const LIMITS: Record<LimitName, { windowMs: number; limit: number }> = {
  login: { windowMs: 60_000, limit: 5 },
  loginHourly: { windowMs: 3_600_000, limit: 20 },
  register: { windowMs: 3_600_000, limit: 10 },
  refresh: { windowMs: 60_000, limit: 30 },
  passwordReset: { windowMs: 3_600_000, limit: 5 },
  messages: { windowMs: 60_000, limit: 30 },
  invites: { windowMs: 3_600_000, limit: 30 },
  uploads: { windowMs: 600_000, limit: 20 },
  reports: { windowMs: 3_600_000, limit: 20 },
};

const ip = (req: Request) => ipKeyGenerator(req.ip || "unknown");

const KEYS: Partial<Record<LimitName, (req: Request) => string>> = {
  login: (req) => `${ip(req)}:${String(req.body?.email || "").trim().toLowerCase()}`,
  passwordReset: (req) => `${ip(req)}:${String(req.body?.email || "").trim().toLowerCase()}`,
  messages: (req) => req.user?.id || ip(req),
  invites: (req) => req.user?.id || ip(req),
  uploads: (req) => req.user?.id || ip(req),
  reports: (req) => req.user?.id || ip(req),
};

function store(name: LimitName): Store | undefined {
  const redis = redisClient();
  if (!redis) return undefined;
  return new RedisStore({
    prefix: `fixlocal:rl:${name}:`,
    sendCommand: (...args: string[]) => redis.sendCommand(args),
  });
}

const noop: RequestHandler = (_req, _res, next) => next();

/** Build the limiter lazily so tests can toggle RATE_LIMIT_ENABLED and override limits. */
export function limiter(name: LimitName, override?: Partial<{ windowMs: number; limit: number }>): RequestHandler {
  let built: RequestHandler | null = null;
  return (req, res, next) => {
    if (!config().rateLimitEnabled) return noop(req, res, next);
    if (!built) {
      const cfg = { ...LIMITS[name], ...override };
      built = rateLimit({
        windowMs: cfg.windowMs,
        limit: cfg.limit,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        store: store(name),
        keyGenerator: KEYS[name] || ip,
        handler: (_req, res, _next, options) => {
          const retryAfter = Math.ceil(options.windowMs / 1000);
          res.status(429).json({
            message: "Too many attempts. Please wait and try again.",
            code: "RATE_LIMITED",
            retryAfter,
          });
        },
      });
    }
    return built(req, res, next);
  };
}
