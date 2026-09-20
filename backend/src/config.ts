import "dotenv/config";
import path from "path";
import { z } from "zod";

const WEAK_SECRETS = new Set(["change-me-in-production", "secret", "changeme", "jwt-secret"]);

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : v === "true" || v === "1"));

const int = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : Number(v)))
    .pipe(z.number().int().nonnegative());

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: int(3001),
    JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
    FILE_URL_SECRET: z.string().optional(),
    ACCESS_TOKEN_TTL_SEC: int(15 * 60),
    REFRESH_TOKEN_TTL_DAYS: int(30),
    REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
    REDIS_ENABLED: bool(true),
    UPLOADS_DIR: z.string().default("uploads"),
    CORS_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:5173"),
    COOKIE_SECURE: bool(false),
    COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
    APP_URL: z.string().default("http://localhost:5173"),
    AUTO_CONFIRM_DAYS: int(3),
    WORKERS_ENABLED: bool(true),
    WORKER_INTERVAL_SEC: int(60),
    TRUST_PROXY: bool(false),
    RATE_LIMIT_ENABLED: bool(true),
    SEED_RESET: bool(false),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      if (env.JWT_SECRET.length < 32 || WEAK_SECRETS.has(env.JWT_SECRET)) {
        ctx.addIssue({
          code: "custom",
          path: ["JWT_SECRET"],
          message: "JWT_SECRET must be a random string of at least 32 characters in production",
        });
      }
      if (!env.FILE_URL_SECRET || env.FILE_URL_SECRET.length < 32) {
        ctx.addIssue({
          code: "custom",
          path: ["FILE_URL_SECRET"],
          message: "FILE_URL_SECRET must be at least 32 characters in production",
        });
      }
    }
  });

export type AppConfig = {
  env: "development" | "test" | "production";
  isProd: boolean;
  isTest: boolean;
  port: number;
  jwtSecret: string;
  fileUrlSecret: string;
  accessTokenTtlSec: number;
  refreshTokenTtlDays: number;
  redisUrl: string;
  redisEnabled: boolean;
  uploadsDir: string;
  corsOrigins: string[];
  cookieSecure: boolean;
  cookieSameSite: "lax" | "strict" | "none";
  appUrl: string;
  autoConfirmDays: number;
  workersEnabled: boolean;
  workerIntervalSec: number;
  trustProxy: boolean;
  rateLimitEnabled: boolean;
  seedReset: boolean;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    isProd: e.NODE_ENV === "production",
    isTest: e.NODE_ENV === "test",
    port: e.PORT,
    jwtSecret: e.JWT_SECRET,
    fileUrlSecret: e.FILE_URL_SECRET || `${e.JWT_SECRET}:files`,
    accessTokenTtlSec: e.ACCESS_TOKEN_TTL_SEC,
    refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
    redisUrl: e.REDIS_URL,
    redisEnabled: e.REDIS_ENABLED,
    uploadsDir: path.resolve(process.cwd(), e.UPLOADS_DIR),
    corsOrigins: e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    cookieSecure: e.COOKIE_SECURE,
    cookieSameSite: e.COOKIE_SAMESITE,
    appUrl: e.APP_URL.replace(/\/$/, ""),
    autoConfirmDays: e.AUTO_CONFIRM_DAYS,
    workersEnabled: e.WORKERS_ENABLED,
    workerIntervalSec: e.WORKER_INTERVAL_SEC,
    trustProxy: e.TRUST_PROXY,
    rateLimitEnabled: e.RATE_LIMIT_ENABLED,
    seedReset: e.SEED_RESET,
  };
}

let cached: AppConfig | null = null;

export function config(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Tests only: override pieces of config at runtime. */
export function overrideConfig(patch: Partial<AppConfig>) {
  cached = { ...config(), ...patch };
}
