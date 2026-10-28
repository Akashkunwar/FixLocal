import "./loadEnv";
import path from "path";
import { z } from "zod";

const WEAK_SECRETS = new Set(["change-me-in-production", "secret", "changeme", "jwt-secret"]);

const TRUE_WORDS = new Set(["true", "1", "yes", "on"]);
const FALSE_WORDS = new Set(["false", "0", "no", "off"]);

/** true/1/yes/on or false/0/no/off, any case. Anything else is an error rather than a silent false. */
const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      const s = (v ?? "").trim().toLowerCase();
      if (s === "") return fallback;
      if (TRUE_WORDS.has(s)) return true;
      if (FALSE_WORDS.has(s)) return false;
      ctx.addIssue({ code: "custom", message: `expected true or false, got "${v}"` });
      return z.NEVER;
    });

const int = (fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? fallback : Number(v)))
    .pipe(z.number().int().min(min).max(max));

/**
 * How many proxies sit in front of the API: 0 (none), or the hop count (nginx alone = 1; an outer
 * TLS proxy / load balancer in front of nginx = 2). "true" means 1 and "false" 0, as before.
 */
const hops = () =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      const s = (v ?? "").trim().toLowerCase();
      if (s === "" || FALSE_WORDS.has(s)) return 0;
      if (s === "true" || s === "yes" || s === "on") return 1;
      const n = Number(s);
      if (Number.isInteger(n) && n >= 0 && n <= 10) return n;
      ctx.addIssue({ code: "custom", message: `expected a proxy hop count (0-10) or true/false, got "${v}"` });
      return z.NEVER;
    });

const DB_DEFAULTS = { DB_HOST: "localhost", DB_PORT: "5432", DB_USERNAME: "fixlocal", DB_PASSWORD: "fixlocal", DB_NAME: "fixlocal" };

const dbSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DB_HOST: z.string().optional(),
  DB_PORT: int(5432, 1, 65535),
  DB_USERNAME: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_NAME: z.string().optional(),
  DB_LOGGING: bool(false),
  MIGRATIONS_RUN: bool(false),
});

export type DbConfig = { host: string; port: number; username: string; password: string; database: string; logging: boolean; migrationsRun: boolean };

/**
 * Database settings, validated like the rest of the config (kept separate because the TypeORM CLI
 * loads the data source without the API's other settings). In production every DB_* must be set.
 */
export function loadDbConfig(source: NodeJS.ProcessEnv = process.env): DbConfig {
  const parsed = dbSchema.safeParse(source);
  const issues = parsed.success ? [] : parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  if (parsed.success && parsed.data.NODE_ENV === "production") {
    for (const key of ["DB_HOST", "DB_USERNAME", "DB_PASSWORD", "DB_NAME"] as const) {
      if (!parsed.data[key]) issues.push(`  - ${key}: required in production`);
    }
  }
  if (!parsed.success || issues.length) throw new Error(`Invalid database configuration:\n${issues.join("\n")}`);
  const e = parsed.data;
  return {
    host: e.DB_HOST || DB_DEFAULTS.DB_HOST,
    port: e.DB_PORT,
    username: e.DB_USERNAME || DB_DEFAULTS.DB_USERNAME,
    password: e.DB_PASSWORD || DB_DEFAULTS.DB_PASSWORD,
    database: e.DB_NAME || DB_DEFAULTS.DB_NAME,
    logging: e.DB_LOGGING,
    migrationsRun: e.MIGRATIONS_RUN,
  };
}

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: int(3001, 1, 65535),
    JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
    FILE_URL_SECRET: z.string().optional(),
    ACCESS_TOKEN_TTL_SEC: int(15 * 60, 10),
    REFRESH_TOKEN_TTL_DAYS: int(30, 1),
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
    APP_URL: z.string().url("APP_URL must be a full URL such as https://fixlocal.in").default("http://localhost:5173"),
    AUTO_CONFIRM_DAYS: int(3),
    JOB_EXPIRY_DAYS: int(30),
    WORKERS_ENABLED: bool(true),
    // At least 5 seconds: 0 would spin the workers in a hot loop.
    WORKER_INTERVAL_SEC: int(60, 5),
    TRUST_PROXY: hops(),
    RATE_LIMIT_ENABLED: bool(true),
    SEED_RESET: bool(false),
    MAIL_PROVIDER: z.enum(["console", "smtp"]).default("console"),
    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default("FixLocal <no-reply@fixlocal.local>"),
    ALLOW_CONSOLE_MAIL: bool(false),
    // Referral programme (simulated credit). 0 turns rewards off.
    REFERRAL_REWARD_INR: int(100),
    REFERRAL_MONTHLY_CAP: int(10),
    REFERRAL_MIN_JOB_INR: int(500),
    // SMS / WhatsApp alerts. Off unless MESSAGING_ENABLED=true; the "log" drivers only write to the log.
    MESSAGING_ENABLED: bool(false),
    SMS_DRIVER: z.enum(["log", "msg91"]).default("log"),
    WHATSAPP_DRIVER: z.enum(["log", "cloud"]).default("log"),
    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_TEMPLATE_ID: z.string().optional(),
    MSG91_SENDER_ID: z.string().optional(),
    WHATSAPP_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_TEMPLATE: z.string().default("fixlocal_update"),
    WHATSAPP_API_VERSION: z.string().default("v21.0"),
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
    if (env.SMS_DRIVER === "msg91" && (!env.MSG91_AUTH_KEY || !env.MSG91_TEMPLATE_ID)) {
      ctx.addIssue({ code: "custom", path: ["MSG91_AUTH_KEY"], message: "SMS_DRIVER=msg91 needs MSG91_AUTH_KEY and MSG91_TEMPLATE_ID" });
    }
    if (env.WHATSAPP_DRIVER === "cloud" && (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID)) {
      ctx.addIssue({
        code: "custom",
        path: ["WHATSAPP_TOKEN"],
        message: "WHATSAPP_DRIVER=cloud needs WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID",
      });
    }
    if (env.COOKIE_SAMESITE === "none" && !env.COOKIE_SECURE) {
      ctx.addIssue({ code: "custom", path: ["COOKIE_SAMESITE"], message: "COOKIE_SAMESITE=none needs COOKIE_SECURE=true (browsers drop it otherwise)" });
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
      } else if (env.FILE_URL_SECRET === env.JWT_SECRET) {
        ctx.addIssue({ code: "custom", path: ["FILE_URL_SECRET"], message: "FILE_URL_SECRET must differ from JWT_SECRET" });
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
  /** Open jobs with no hire close after this many days unless the client keeps them open. */
  jobExpiryDays: number;
  workersEnabled: boolean;
  workerIntervalSec: number;
  /** Proxy hops in front of the API (0 = none). Sets Express "trust proxy", so req.ip is the real client. */
  trustProxy: number;
  rateLimitEnabled: boolean;
  seedReset: boolean;
  mailProvider: "console" | "smtp";
  smtpUrl: string | null;
  mailFrom: string;
  referral: { rewardInr: number; monthlyCap: number; minJobInr: number };
  messaging: {
    enabled: boolean;
    smsDriver: "log" | "msg91";
    whatsappDriver: "log" | "cloud";
    msg91: { authKey: string; templateId: string; senderId: string | null } | null;
    whatsapp: { token: string; phoneNumberId: string; template: string; apiVersion: string } | null;
  };
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
    jobExpiryDays: e.JOB_EXPIRY_DAYS,
    workersEnabled: e.WORKERS_ENABLED,
    workerIntervalSec: e.WORKER_INTERVAL_SEC,
    trustProxy: e.TRUST_PROXY,
    rateLimitEnabled: e.RATE_LIMIT_ENABLED,
    seedReset: e.SEED_RESET,
    mailProvider: e.MAIL_PROVIDER,
    smtpUrl: e.SMTP_URL || null,
    mailFrom: e.MAIL_FROM,
    referral: { rewardInr: e.REFERRAL_REWARD_INR, monthlyCap: e.REFERRAL_MONTHLY_CAP, minJobInr: e.REFERRAL_MIN_JOB_INR },
    messaging: {
      enabled: e.MESSAGING_ENABLED,
      smsDriver: e.SMS_DRIVER,
      whatsappDriver: e.WHATSAPP_DRIVER,
      msg91:
        e.MSG91_AUTH_KEY && e.MSG91_TEMPLATE_ID
          ? { authKey: e.MSG91_AUTH_KEY, templateId: e.MSG91_TEMPLATE_ID, senderId: e.MSG91_SENDER_ID || null }
          : null,
      whatsapp:
        e.WHATSAPP_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID
          ? { token: e.WHATSAPP_TOKEN, phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID, template: e.WHATSAPP_TEMPLATE, apiVersion: e.WHATSAPP_API_VERSION }
          : null,
    },
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
