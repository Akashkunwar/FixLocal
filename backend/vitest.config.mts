import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

const uploads = path.join(os.tmpdir(), `fixlocal-test-uploads-${process.pid}`);

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/globalSetup.ts"],
    setupFiles: ["test/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      DB_NAME: process.env.TEST_DB_NAME || "fixlocal_test",
      JWT_SECRET: "test-secret-that-is-long-enough-for-hs256-signing",
      FILE_URL_SECRET: "test-file-url-secret-that-is-also-long-enough",
      REDIS_URL: process.env.TEST_REDIS_URL || "redis://127.0.0.1:6379/15",
      REDIS_ENABLED: process.env.TEST_REDIS_ENABLED || "true",
      UPLOADS_DIR: uploads,
      RATE_LIMIT_ENABLED: "false",
      WORKERS_ENABLED: "false",
      CORS_ORIGINS: "http://localhost:5174",
      LOG_LEVEL: "silent",
      DB_LOGGING: "false",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/migrations/**", "src/scripts/**", "src/server.ts", "src/index.ts", "src/types/**"],
      reporter: ["text-summary", "text", "html"],
    },
  },
});
