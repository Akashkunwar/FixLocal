import type { Request, RequestHandler } from "express";
import rateLimit, { ipKeyGenerator, type Store } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { config } from "../config";
import { onTestCacheFlush, redisClient } from "../utils/cache";

type LimitName =
  | "login"
  | "loginHourly"
  | "register"
  | "refresh"
  | "passwordReset"
  | "resetPassword"
  | "verifyEmail"
  | "resendVerification"
  | "phoneCode"
  | "changePassword"
  | "messages"
  | "invites"
  | "uploads"
  | "reports"
  | "jobPosts"
  | "bids"
  | "blocks"
  | "exports"
  | "emailSends"
  | "publicReads";

const LIMITS: Record<LimitName, { windowMs: number; limit: number }> = {
  login: { windowMs: 60_000, limit: 5 },
  loginHourly: { windowMs: 3_600_000, limit: 20 },
  register: { windowMs: 3_600_000, limit: 10 },
  refresh: { windowMs: 60_000, limit: 30 },
  // Each sensitive auth step has its own bucket, so failures on one can't lock a user out of another.
  passwordReset: { windowMs: 3_600_000, limit: 5 },
  resetPassword: { windowMs: 3_600_000, limit: 10 },
  verifyEmail: { windowMs: 3_600_000, limit: 10 },
  resendVerification: { windowMs: 3_600_000, limit: 5 },
  phoneCode: { windowMs: 3_600_000, limit: 10 },
  changePassword: { windowMs: 60_000, limit: 5 },
  messages: { windowMs: 60_000, limit: 30 },
  invites: { windowMs: 3_600_000, limit: 30 },
  uploads: { windowMs: 600_000, limit: 20 },
  reports: { windowMs: 3_600_000, limit: 20 },
  jobPosts: { windowMs: 3_600_000, limit: 20 },
  bids: { windowMs: 3_600_000, limit: 60 },
  blocks: { windowMs: 3_600_000, limit: 30 },
  exports: { windowMs: 3_600_000, limit: 5 },
  // Caps mail one client can trigger to one address (sign-up, reset, confirmation). Over the cap the
  // request still gets its normal answer; the mail is just not sent (see mailSuppressed).
  emailSends: { windowMs: 3_600_000, limit: 5 },
  // Pages anyone can open without an account (public pro profiles and their SEO tags).
  publicReads: { windowMs: 60_000, limit: 120 },
};

const ip = (req: Request) => ipKeyGenerator(req.ip || "unknown");
const email = (req: Request) => String(req.body?.email || "").trim().toLowerCase();

/** The three key shapes: client + address, the signed-in user (else the client), or just the client. */
const byIpAndEmail = (req: Request) => `${ip(req)}:${email(req)}`;
const byUser = (req: Request) => (req.user?.id ? `u:${req.user.id}` : ip(req));

const KEYS: Partial<Record<LimitName, (req: Request) => string>> = {
  login: byIpAndEmail,
  passwordReset: byIpAndEmail,
  changePassword: byUser,
  resendVerification: byUser,
  phoneCode: byUser,
  messages: byUser,
  invites: byUser,
  uploads: byUser,
  reports: byUser,
  jobPosts: byUser,
  bids: byUser,
  blocks: byUser,
  exports: byUser,
  emailSends: (req) => `mail:${byIpAndEmail(req)}`,
};

/** Limits that never answer 429: over the cap the request carries on with res.locals.mailSuppressed set. */
const QUIET: Partial<Record<LimitName, true>> = { emailSends: true };

/** True when the emailSends limit was hit: answer as usual, but don't send the mail. */
export const mailSuppressed = (res: { locals: Record<string, unknown> }) => res.locals.mailSuppressed === true;

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
let generation = 0;
// Without Redis the counters live in each limiter's memory store; tests start each case from zero.
onTestCacheFlush(() => {
  generation++;
});

export function limiter(name: LimitName, override?: Partial<{ windowMs: number; limit: number }>): RequestHandler {
  let built: RequestHandler | null = null;
  let builtFor = -1;
  return (req, res, next) => {
    if (!config().rateLimitEnabled) return noop(req, res, next);
    if (!built || builtFor !== generation) {
      builtFor = generation;
      const cfg = { ...LIMITS[name], ...override };
      built = rateLimit({
        windowMs: cfg.windowMs,
        limit: cfg.limit,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        store: store(name),
        keyGenerator: KEYS[name] || ip,
        // Built on first use on purpose (Redis connects after routes are defined, and tests
        // toggle limits at runtime), so skip the library's "created in a request handler" warning.
        validate: { creationStack: false },
        handler: (_req, res, next, options) => {
          if (QUIET[name]) {
            res.locals.mailSuppressed = true;
            return next();
          }
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
