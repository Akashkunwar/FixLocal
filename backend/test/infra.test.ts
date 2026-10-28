import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { config, loadConfig, loadDbConfig, overrideConfig } from "../src/config";
import { ALL_MIGRATIONS } from "../src/db/migrationList";
import { uniqueEmail } from "./helpers";

const base = { JWT_SECRET: "test-secret" } as NodeJS.ProcessEnv;
const prod = {
  NODE_ENV: "production",
  JWT_SECRET: "x".repeat(40),
  FILE_URL_SECRET: "y".repeat(40),
  MAIL_PROVIDER: "console",
  ALLOW_CONSOLE_MAIL: "true",
} as NodeJS.ProcessEnv;

describe("environment validation (infra MED 6)", () => {
  it("reads booleans in any case and rejects words it doesn't know", () => {
    expect(loadConfig({ ...base, COOKIE_SECURE: "TRUE" }).cookieSecure).toBe(true);
    expect(loadConfig({ ...base, COOKIE_SECURE: "Yes" }).cookieSecure).toBe(true);
    expect(loadConfig({ ...base, RATE_LIMIT_ENABLED: "off" }).rateLimitEnabled).toBe(false);
    expect(() => loadConfig({ ...base, COOKIE_SECURE: "ture" })).toThrow(/COOKIE_SECURE/);
  });

  it("rejects intervals and lifetimes that would break the app", () => {
    expect(() => loadConfig({ ...base, WORKER_INTERVAL_SEC: "0" })).toThrow(/WORKER_INTERVAL_SEC/);
    expect(() => loadConfig({ ...base, ACCESS_TOKEN_TTL_SEC: "0" })).toThrow(/ACCESS_TOKEN_TTL_SEC/);
    expect(() => loadConfig({ ...base, PORT: "70000" })).toThrow(/PORT/);
    expect(() => loadConfig({ ...base, APP_URL: "fixlocal.in" })).toThrow(/APP_URL/);
    expect(() => loadConfig({ ...base, COOKIE_SAMESITE: "none" })).toThrow(/COOKIE_SAMESITE/);
    expect(loadConfig({ ...base, COOKIE_SAMESITE: "none", COOKIE_SECURE: "true" }).cookieSameSite).toBe("none");
  });

  it("in production, needs a separate file-URL secret and every DB_* setting", () => {
    expect(() => loadConfig(prod)).not.toThrow();
    expect(() => loadConfig({ ...prod, FILE_URL_SECRET: prod.JWT_SECRET })).toThrow(/FILE_URL_SECRET must differ/);
    expect(() => loadDbConfig({ NODE_ENV: "production" })).toThrow(/DB_HOST: required in production/);
    expect(
      loadDbConfig({
        NODE_ENV: "production",
        DB_HOST: "db",
        DB_USERNAME: "u",
        DB_PASSWORD: "p",
        DB_NAME: "n",
        MIGRATIONS_RUN: "TRUE",
      })
    ).toMatchObject({ host: "db", database: "n", migrationsRun: true });
    expect(() => loadDbConfig({ DB_PORT: "abc" })).toThrow(/DB_PORT/);
  });

  it("TRUST_PROXY takes a hop count (true = 1, false = 0)", () => {
    expect(loadConfig({ ...base }).trustProxy).toBe(0);
    expect(loadConfig({ ...base, TRUST_PROXY: "true" }).trustProxy).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY: "2" }).trustProxy).toBe(2);
    expect(() => loadConfig({ ...base, TRUST_PROXY: "lots" })).toThrow(/TRUST_PROXY/);
  });
});

describe("two proxies in front of the API (infra CRIT 1)", () => {
  async function badLogins(trustProxy: number) {
    const original = config();
    overrideConfig({ trustProxy, rateLimitEnabled: true });
    try {
      const app = createApp();
      const email = uniqueEmail("proxy");
      // Outer TLS proxy appends the real client; nginx appends the outer proxy (10.0.0.2).
      const via = (client: string) => ({ "X-Forwarded-For": `${client}, 10.0.0.2` });
      for (let i = 0; i < 5; i++) {
        await request(app).post("/api/auth/login").set(via("198.51.100.1")).send({ email, password: "Wrong-pass-123" });
      }
      const sameClient = await request(app)
        .post("/api/auth/login")
        .set(via("198.51.100.1"))
        .send({ email, password: "Wrong-pass-123" });
      const otherClient = await request(app)
        .post("/api/auth/login")
        .set(via("198.51.100.2"))
        .send({ email, password: "Wrong-pass-123" });
      return { same: sameClient.status, other: otherClient.status };
    } finally {
      overrideConfig({ trustProxy: original.trustProxy, rateLimitEnabled: original.rateLimitEnabled });
    }
  }

  it("with TRUST_PROXY=2 each real client has its own rate limit", async () => {
    expect(await badLogins(2)).toEqual({ same: 429, other: 401 });
  });

  it("with only one hop trusted, everyone behind the outer proxy would share one bucket", async () => {
    expect(await badLogins(1)).toEqual({ same: 429, other: 429 });
  });
});

describe("migrations list (infra MED 10)", () => {
  it("lists every file in src/migrations, in order", () => {
    const dir = path.join(__dirname, "../src/migrations");
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^\d+-.+\.ts$/.test(f))
      .sort();
    const names = files.map((f) => {
      const [ts, name] = f.replace(/\.ts$/, "").split("-");
      return `${name}${ts}`;
    });
    expect(ALL_MIGRATIONS.map((m) => m.name)).toEqual(names);
  });
});

describe("admin config rollback (infra MED 15)", () => {
  it("writes several settings all-or-nothing", async () => {
    const { getMatchWeights, saveConfigs, MATCH_WEIGHTS_KEY, clearConfigCache } =
      await import("../src/utils/matchWeights");
    const before = await getMatchWeights();
    const changed = { ...before, skills: before.skills === 40 ? 41 : 40 };
    await expect(
      saveConfigs([
        { key: MATCH_WEIGHTS_KEY, value: changed as unknown as Record<string, unknown> },
        { key: "k".repeat(80), value: { broken: true } }, // longer than the key column: the batch fails
      ])
    ).rejects.toThrow();
    clearConfigCache();
    expect(await getMatchWeights()).toEqual(before);
  });

  it("answers a missing audit row with a coded 404", async () => {
    const { admin, api } = await import("./helpers");
    const a = await admin();
    const res = await api()
      .post("/api/admin/match-weights/rollback")
      .set(a.auth)
      .send({ auditLogId: "00000000-0000-4000-8000-000000000000" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});
