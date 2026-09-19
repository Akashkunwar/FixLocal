import { describe, expect, it, vi } from "vitest";
import { api, ApiError, hasAccessToken, login, onUnauthenticated, setAccessToken } from "./client";
import { authHeader, json, mockFetch } from "../test/http";

const session = (token: string) => ({ token, expiresIn: 900, user: { id: "u1", email: "a@b.c", role: "HOMEOWNER" } });

describe("api client auth (H-1)", () => {
  it("keeps the access token in memory only", async () => {
    mockFetch((url) => (url.endsWith("/api/auth/login") ? json(200, session("tok-1")) : undefined));
    await login("a@b.c", "Long-password-1");
    expect(hasAccessToken()).toBe(true);
    expect(JSON.stringify({ ...localStorage })).not.toContain("tok-1");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("tok-1");
  });

  it("refreshes once for concurrent 401s and retries each request", async () => {
    setAccessToken("expired");
    let refreshes = 0;
    const { calls } = mockFetch(async (url, init) => {
      if (url.endsWith("/api/auth/refresh")) {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, session("fresh"));
      }
      if (url.includes("/api/things/")) {
        return authHeader(init) === "Bearer fresh" ? json(200, { ok: url }) : json(401, { code: "UNAUTHORIZED" });
      }
      return undefined;
    });
    const results = await Promise.all([api("/api/things/1"), api("/api/things/2"), api("/api/things/3")]);
    expect(refreshes).toBe(1);
    expect(results).toEqual([{ ok: "/api/things/1" }, { ok: "/api/things/2" }, { ok: "/api/things/3" }]);
    const refreshCall = calls.find((c) => c.url.endsWith("/api/auth/refresh"))!;
    expect(refreshCall.init.credentials).toBe("include");
  });

  it("retries without a second refresh when another request already refreshed", async () => {
    setAccessToken("old");
    let refreshes = 0;
    let releaseSlow: () => void = () => undefined;
    mockFetch(async (url, init) => {
      if (url.endsWith("/api/auth/refresh")) {
        refreshes += 1;
        return json(200, session("fresh"));
      }
      if (url === "/api/slow" && authHeader(init) === "Bearer old") {
        await new Promise<void>((r) => (releaseSlow = r));
        return json(401, {});
      }
      if (url === "/api/fast" && authHeader(init) === "Bearer old") return json(401, {});
      return json(200, { url, auth: authHeader(init) });
    });
    const slow = api("/api/slow");
    await api("/api/fast");
    releaseSlow();
    await expect(slow).resolves.toEqual({ url: "/api/slow", auth: "Bearer fresh" });
    expect(refreshes).toBe(1);
  });

  it("ends the session when the refresh fails", async () => {
    setAccessToken("expired");
    const lost = vi.fn();
    onUnauthenticated(lost);
    mockFetch((url) => (url.endsWith("/api/auth/refresh") ? json(401, {}) : json(401, { message: "Sign in again" })));
    await expect(api("/api/jobs")).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledTimes(1);
    expect(hasAccessToken()).toBe(false);
    onUnauthenticated(null);
  });

  it("does not try to refresh after a failed login", async () => {
    const { calls } = mockFetch((url) => (url.endsWith("/api/auth/login") ? json(401, { message: "Invalid email or password" }) : undefined));
    await expect(login("a@b.c", "nope-nope-nope")).rejects.toBeInstanceOf(ApiError);
    expect(calls.map((c) => c.url)).toEqual(["/api/auth/login"]);
  });

  it("signs out a suspended account", async () => {
    setAccessToken("ok");
    const lost = vi.fn();
    onUnauthenticated(lost);
    mockFetch(() => json(403, { code: "ACCOUNT_SUSPENDED", message: "Suspended" }));
    await expect(api("/api/jobs")).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
    expect(lost).toHaveBeenCalled();
    onUnauthenticated(null);
  });

  it("survives non-JSON error bodies", async () => {
    mockFetch(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(api("/api/jobs")).rejects.toMatchObject({ status: 502, message: "<html>Bad gateway</html>" });
  });
});
