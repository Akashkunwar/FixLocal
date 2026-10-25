import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

/**
 * Loads backend/.env into process.env (never overriding values already set).
 *
 * Under NODE_ENV=test only connection settings are taken from .env, so a developer's local
 * flags (DEV_AUTO_VERIFY_EMAIL, AUTO_CONFIRM_DAYS, SEED_*, …) can't change test behaviour.
 */
const TEST_PASSTHROUGH = /^(DB_HOST|DB_PORT|DB_USERNAME|DB_PASSWORD|DB_SSL)$/;

export function loadEnv(file = path.resolve(process.cwd(), ".env"), env: NodeJS.ProcessEnv = process.env) {
  if (!fs.existsSync(file)) return;
  const parsed = dotenv.parse(fs.readFileSync(file));
  const isTest = env.NODE_ENV === "test";
  for (const [k, v] of Object.entries(parsed)) {
    if (env[k] !== undefined) continue;
    if (isTest && !TEST_PASSTHROUGH.test(k)) continue;
    env[k] = v;
  }
}

loadEnv();
