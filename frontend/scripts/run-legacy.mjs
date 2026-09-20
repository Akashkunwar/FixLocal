/**
 * Runs every legacy wave smoke script through the compatibility shim and prints a summary.
 *
 *   API_URL=http://127.0.0.1:3102 FE_URL=http://127.0.0.1:5175 \
 *   RESET_CMD="npm --prefix ../backend run db:reset-e2e && npm --prefix ../backend run seed" \
 *   npm run legacy:smoke
 *
 * RESET_CMD (optional) runs before each script so one script's leftovers can't break the next.
 * Point it at a throwaway database only: the scripts create users, jobs and payments.
 */
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.API_URL) {
  console.error("Set API_URL (and FE_URL) to a throwaway stack, e.g. the one `npm run test:e2e` uses.");
  process.exit(2);
}
const scripts = fs
  .readdirSync(here)
  .filter((f) => /^wave\d+-smoke\.mjs$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

const results = [];
for (const file of scripts) {
  if (process.env.RESET_CMD) execSync(process.env.RESET_CMD, { stdio: "ignore", shell: true });
  const run = spawnSync(process.execPath, ["--import", path.join(here, "legacy-compat.mjs"), path.join(here, file)], {
    encoding: "utf8",
    timeout: 180_000,
    env: process.env,
  });
  const ok = run.status === 0;
  const reason = ok ? "" : `${run.stdout}\n${run.stderr}`.split("\n").find((l) => /FAIL|Error/.test(l))?.trim() || "failed";
  results.push({ file, ok, reason });
  console.log(`${ok ? "PASS" : "FAIL"}  ${file}${ok ? "" : `  — ${reason.slice(0, 200)}`}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} legacy smoke scripts passed`);
process.exit(failed ? 1 : 0);
