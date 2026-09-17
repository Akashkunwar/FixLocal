import { afterAll, afterEach, beforeAll, expect } from "vitest";
import { AppDataSource } from "../src/data-source";
import { closeCache, flushTestCache, initCache } from "../src/utils/cache";
import { clearAuthStateMemory } from "../src/auth/authState";
import { ensureUploadDirs } from "../src/services/files";
import { closeAllStreams } from "../src/utils/sse";

const crashes: unknown[] = [];
const onCrash = (err: unknown) => {
  crashes.push(err);
};

/** Any response body containing these keys fails the test run (C-2 regression). */
const FORBIDDEN_KEYS = new Set(["passwordHash", "tokenHash"]);
export const leakedKeys: string[] = [];

function scan(value: unknown, path: string, depth = 0) {
  if (!value || typeof value !== "object" || depth > 12) return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(k)) leakedKeys.push(`${path}.${k}`);
    scan(v, `${path}.${k}`, depth + 1);
  }
}

(globalThis as Record<string, unknown>).__FIXLOCAL_JSON_INSPECTOR__ = (url: string, body: unknown) => scan(body, url);

beforeAll(async () => {
  process.on("unhandledRejection", onCrash);
  process.on("uncaughtException", onCrash);
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  await initCache();
  await flushTestCache();
  clearAuthStateMemory();
  ensureUploadDirs();
  const tables: { tablename: string }[] = await AppDataSource.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'`
  );
  if (tables.length) {
    await AppDataSource.query(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
});

afterEach(() => {
  expect(crashes, "server threw an unhandled error").toEqual([]);
  expect(leakedKeys, "a response leaked a secret field").toEqual([]);
});

afterAll(async () => {
  process.off("unhandledRejection", onCrash);
  process.off("uncaughtException", onCrash);
  closeAllStreams();
  await closeCache();
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
});
