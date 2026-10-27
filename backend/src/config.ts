import "./loadEnv";
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
    // Uploaded files: "local" (UPLOADS_DIR on this host) or "s3" (any S3-compatible bucket; needed for several API instances).
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default("auto"),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool(false),
    S3_PREFIX: z.string().default(""),
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
    MAIL_PROVIDER: z.enum(["console", "smtp"]).default("console"),
    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default("FixLocal <no-reply@fixlocal.local>"),
    ALLOW_CONSOLE_MAIL: bool(false),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === "s3" && !env.S3_BUCKET) {
      ctx.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "S3_BUCKET is required when STORAGE_DRIVER=s3" });
    }
    if (!!env.S3_ACCESS_KEY_ID !== !!env.S3_SECRET_ACCESS_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["S3_SECRET_ACCESS_KEY"],
        message: "Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither (to use the default AWS credential chain)",
      });
    }
    if (env.MAIL_PROVIDER === "smtp" && !env.SMTP_URL) {
      ctx.addIssue({ code: "custom", path: ["SMTP_URL"], message: "SMTP_URL is required when MAIL_PROVIDER=smtp" });
    }
    if (env.NODE_ENV === "production") {
      if (env.JWT_SECRET.length < 32 || WEAK_SECRETS.has(env.JWT_SECRET)) {
        ctx.addIssue({
          code: "custom",
          path: ["JWT_SECRET"],
          message: "JWT_SECRET must be a random string of at least 32 characters in production",
        });
      }
      if (env.MAIL_PROVIDER === "console" && !env.ALLOW_CONSOLE_MAIL) {
        ctx.addIssue({
          code: "custom",
          path: ["MAIL_PROVIDER"],
          message:
            "Set MAIL_PROVIDER=smtp with SMTP_URL so verification and password-reset emails are delivered (or ALLOW_CONSOLE_MAIL=true for a private test deployment)",
        });
      }
      if (env.APP_URL.startsWith("https://") && !env.COOKIE_SECURE) {
        ctx.addIssue({
          code: "custom",
          path: ["COOKIE_SECURE"],
          message: "COOKIE_SECURE must be true when the app is served over HTTPS",
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
  storageDriver: "local" | "s3";
  s3: {
    bucket: string;
    region: string;
    endpoint: string | null;
    accessKeyId: string | null;
    secretAccessKey: string | null;
    forcePathStyle: boolean;
    prefix: string;
  } | null;
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
  mailProvider: "console" | "smtp";
  smtpUrl: string | null;
  mailFrom: string;
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
    storageDriver: e.STORAGE_DRIVER,
    s3:
      e.STORAGE_DRIVER === "s3" && e.S3_BUCKET
        ? {
            bucket: e.S3_BUCKET,
            region: e.S3_REGION,
            endpoint: e.S3_ENDPOINT || null,
            accessKeyId: e.S3_ACCESS_KEY_ID || null,
            secretAccessKey: e.S3_SECRET_ACCESS_KEY || null,
            forcePathStyle: e.S3_FORCE_PATH_STYLE,
            prefix: e.S3_PREFIX,
          }
        : null,
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
    mailProvider: e.MAIL_PROVIDER,
    smtpUrl: e.SMTP_URL || null,
    mailFrom: e.MAIL_FROM,
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
