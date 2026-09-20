import { describe, expect, it, vi } from "vitest";
import { api, client, PASSWORD, uniqueEmail } from "./helpers";
import { overrideConfig } from "../src/config";
import { flushTestCache } from "../src/utils/cache";

describe("security headers and CORS (H-7)", () => {
  it("sets defensive headers", async () => {
    const res = await api().get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("only allows configured origins, with credentials", async () => {
    const good = await api().get("/health").set("Origin", "http://localhost:5174");
    expect(good.headers["access-control-allow-origin"]).toBe("http://localhost:5174");
    expect(good.headers["access-control-allow-credentials"]).toBe("true");
    const evil = await api().get("/health").set("Origin", "https://evil.example");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
    const preflight = await api()
      .options("/api/auth/login")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST");
    expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("rate limiting (H-7)", () => {
  it("throttles repeated logins per email", async () => {
    overrideConfig({ rateLimitEnabled: true });
    await flushTestCache();
    const consoleError = vi.spyOn(console, "error");
    try {
      const c = await client();
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) {
        const res = await api().post("/api/auth/login").send({ email: c.user.email, password: "wrong-password-x" });
        statuses.push(res.status);
        if (res.status === 429) {
          expect(res.body.code).toBe("RATE_LIMITED");
          expect(res.body.retryAfter).toBeGreaterThan(0);
        }
      }
      expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(statuses.slice(5)).toEqual([429, 429]);
      // Another account from the same IP isn't locked out by that.
      const other = await client();
      expect((await api().post("/api/auth/login").send({ email: other.user.email, password: PASSWORD })).status).toBe(200);
      // The limiter must not flood production logs with library validation warnings.
      expect(consoleError.mock.calls.map((c) => String(c[0]))).not.toContainEqual(expect.stringContaining("ValidationError"));
    } finally {
      consoleError.mockRestore();
      overrideConfig({ rateLimitEnabled: false });
      await flushTestCache();
    }
  });

  it("throttles registrations per IP", async () => {
    overrideConfig({ rateLimitEnabled: true });
    await flushTestCache();
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        const res = await api()
          .post("/api/auth/register")
          .send({ email: uniqueEmail("rl"), password: "Long-enough-pass-9", role: "HOMEOWNER" });
        statuses.push(res.status);
      }
      expect(statuses.filter((s) => s === 201)).toHaveLength(10);
      expect(statuses.at(-1)).toBe(429);
    } finally {
      overrideConfig({ rateLimitEnabled: false });
      await flushTestCache();
    }
  });
});
