import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { api, client } from "./helpers";
import { HI_TITLES, localizeTitle } from "../src/domain/i18n";

/** Every fixed notification title in the code needs a Hindi version (ux HIGH 3). */
function fixedTitles(): string[] {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(".ts")) {
        const src = fs.readFileSync(p, "utf8");
        if (!/createNotifications?\(/.test(src)) continue;
        for (const line of src.split("\n")) {
          const m = /^\s*title:\s*(.+?),?\s*$/.exec(line);
          if (!m) continue;
          // Skip comparison operands (status === "accepted") and fallbacks for user text (job?.title || "Job").
          for (const lit of m[1].matchAll(/(===\s*|\|\|\s*)?"([^"]+)"/g)) if (!lit[1]) out.add(lit[2]);
        }
      }
    }
  };
  walk(path.join(__dirname, "../src"));
  return [...out];
}

describe("notification titles in Hindi", () => {
  it("has a Hindi title for every fixed English title", () => {
    const titles = fixedTitles();
    expect(titles).toContain("New message");
    const missing = titles.filter((t) => !HI_TITLES[t] && localizeTitle("hi", t) === t);
    expect(missing).toEqual([]);
  });
});

describe("error responses carry a code the app can translate (ux HIGH 3, MED 10)", () => {
  it("names a bad reset link and a bad id instead of 'Invalid request'", async () => {
    const reset = await api().post("/api/auth/reset-password").send({ token: "short", password: "Another-pass-123" });
    expect(reset.status).toBe(400);
    expect(reset.body).toMatchObject({ code: "TOKEN_INVALID" });
    expect(reset.body.message).toMatch(/invalid or has expired/);

    const c = await client();
    const job = await api().get("/api/jobs/not-a-uuid").set(c.auth);
    expect(job.status).toBe(400);
    expect(job.body).toMatchObject({ code: "INVALID_ID" });
  });

  it("puts a code on every kind of error", async () => {
    const c = await client();
    const responses = await Promise.all([
      api().get("/api/no-such-route"),
      api().get("/api/auth/me"),
      api().post("/api/auth/login").set("Content-Type", "application/json").send("{bad json"),
      api().post("/api/auth/login").send({ email: "x@example.com", password: "wrong-password-1" }),
      api().get("/api/jobs/00000000-0000-4000-8000-000000000000").set(c.auth),
      api().get("/api/admin/stats").set(c.auth),
    ]);
    for (const r of responses) {
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(typeof r.body.code).toBe("string");
    }
  });
});
