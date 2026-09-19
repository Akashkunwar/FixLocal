import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run a real backend (port 3101) on a throwaway database (fixlocal_e2e,
 * recreated on every run) and the Vite dev server (port 5174) proxying /api to it.
 * The developer's own servers (3001 / 5173) and database are never touched.
 */
const API_PORT = 3101;
const WEB_PORT = 5174;
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
export const E2E_PASSWORD = "E2e-Password-123";

const backendEnv = {
  NODE_ENV: "development",
  PORT: String(API_PORT),
  DB_NAME: process.env.E2E_DB_NAME || "fixlocal_e2e",
  JWT_SECRET: "e2e-jwt-secret-that-is-definitely-long-enough",
  FILE_URL_SECRET: "e2e-file-url-secret-that-is-long-enough-too",
  // Short-lived access tokens so every journey exercises silent refresh.
  ACCESS_TOKEN_TTL_SEC: "20",
  REDIS_URL: process.env.E2E_REDIS_URL || "redis://127.0.0.1:6379/14",
  REDIS_ENABLED: process.env.E2E_REDIS_ENABLED || "true",
  UPLOADS_DIR: path.join(os.tmpdir(), "fixlocal-e2e-uploads"),
  CORS_ORIGINS: `${WEB_URL},http://localhost:${WEB_PORT}`,
  APP_URL: WEB_URL,
  DEV_OUTBOX: "true",
  RATE_LIMIT_ENABLED: "false",
  WORKERS_ENABLED: "false",
  SEED_PASSWORD: E2E_PASSWORD,
  SEED_RESET: "true",
  LOG_LEVEL: "warn",
};

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm --prefix ../backend run e2e:server",
      url: `http://127.0.0.1:${API_PORT}/health`,
      env: backendEnv,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      env: {
        VITE_PORT: String(WEB_PORT),
        VITE_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`,
        VITE_API_URL: "",
        VITE_DEMO_MODE: "false",
      },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
