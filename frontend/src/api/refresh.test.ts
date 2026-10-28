import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, mockFetch } from "../test/http";

const session = (token: string) => ({ token, expiresIn: 900, user: { id: "u1", email: "a@b.c", role: "HOMEOWNER" } });

/** A fresh copy of the client module = one browser tab (localStorage and BroadcastChannel are shared). */
async function openTab() {
  vi.resetModules();
  const client = await import("./client");
  const lock = await import("./refreshLock");
  client.setRefreshBackoffForTests([5, 5, 5]);
  return { client, lock };
}

/** Minimal Web Locks: one exclusive queue per name, shared by every "tab" in the test. */
function fakeWebLocks() {
  const queues = new Map<string, Promise<unknown>>();
  const locks = {
    request: (name: string, _opts: unknown, fn: () => Promise<unknown>) => {
      const prev = queues.get(name) ?? Promise.resolve();
      const run = prev.then(() => fn());
      queues.set(name, run.catch(() => undefined));
      return run;
    },
  };
  vi.stubGlobal("navigator", { ...navigator, locks });
}

describe("session refresh across tabs (fe-logic CRIT 1)", () => {
  const opened: { lock: typeof import("./refreshLock") }[] = [];
  afterEach(() => {
    opened.forEach((t) => t.lock.resetRefreshLockForTests());
    opened.length = 0;
  });

  it("two tabs refreshing at once rotate the cookie only once and share the new token", async () => {
    fakeWebLocks();
    let refreshes = 0;
    mockFetch(async (url) => {
      if (url.endsWith("/api/auth/refresh")) {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 20));
        return json(200, session(`fresh-${refreshes}`));
      }
      return undefined;
    });
    const a = await openTab();
    const b = await openTab();
    opened.push(a, b);
    const [sa, sb] = await Promise.all([a.client.refreshSession(), b.client.refreshSession()]);
    expect(refreshes).toBe(1);
    expect(sa?.token).toBe("fresh-1");
    expect(sb?.token).toBe("fresh-1");
    expect(b.client.hasAccessToken()).toBe(true);
  });

  it("without Web Locks, waits for the tab holding the storage lock and reuses its result", async () => {
    vi.stubGlobal("navigator", { ...navigator, locks: undefined });
    const { calls } = mockFetch(() => json(200, session("mine")));
    const tab = await openTab();
    opened.push(tab);
    localStorage.setItem("fixlocal-auth:refresh-lock", JSON.stringify({ id: "other-tab", until: Date.now() + 5_000 }));
    const pending = tab.client.refreshSession();
    await new Promise((r) => setTimeout(r, 120));
    // The other tab finishes: records the time, broadcasts the session, releases the lock.
    const at = Date.now();
    localStorage.setItem("fixlocal-auth:refreshed-at", String(at));
    const other = new BroadcastChannel("fixlocal-auth");
    other.postMessage({ type: "refreshed", at, value: { kind: "ok", session: session("from-other-tab") } });
    localStorage.removeItem("fixlocal-auth:refresh-lock");
    await expect(pending).resolves.toMatchObject({ token: "from-other-tab" });
    expect(calls).toHaveLength(0);
    other.close();
  });
});

describe("refresh failures (fe-logic MED 9)", () => {
  let tab: Awaited<ReturnType<typeof openTab>>;
  beforeEach(async () => {
    vi.stubGlobal("navigator", { ...navigator, locks: undefined });
    tab = await openTab();
  });
  afterEach(() => tab.lock.resetRefreshLockForTests());

  it("retries a 5xx / 429 / network error and keeps the session", async () => {
    const answers: (() => Response)[] = [
      () => json(503, {}),
      () => json(429, {}),
      () => {
        throw new TypeError("Failed to fetch");
      },
      () => json(200, session("after-retries")),
    ];
    let n = 0;
    mockFetch(() => answers[n++]());
    await expect(tab.client.refreshSession()).resolves.toMatchObject({ token: "after-retries" });
    expect(n).toBe(4);
  });

  it("does not log out when the server stays unreachable", async () => {
    tab.client.setAccessToken("expired");
    const lost = vi.fn();
    tab.client.onUnauthenticated(lost);
    mockFetch((url) => (url.endsWith("/api/auth/refresh") ? json(502, {}) : json(401, {})));
    await expect(tab.client.api("/api/jobs")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(lost).not.toHaveBeenCalled();
    expect(localStorage.getItem("fixlocal:session")).toBe("1");
  });

  it("logs out only on a real 401 from the refresh endpoint", async () => {
    tab.client.setAccessToken("expired");
    const lost = vi.fn();
    tab.client.onUnauthenticated(lost);
    const { calls } = mockFetch((url) => (url.endsWith("/api/auth/refresh") ? json(401, {}) : json(401, {})));
    await expect(tab.client.api("/api/jobs")).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.url.endsWith("/api/auth/refresh"))).toHaveLength(1);
  });

  it("retries a 409 REFRESH_IN_PROGRESS instead of logging out", async () => {
    const lost = vi.fn();
    tab.client.onUnauthenticated(lost);
    let n = 0;
    mockFetch(() => (n++ === 0 ? json(409, { code: "REFRESH_IN_PROGRESS" }) : json(200, session("after-409"))));
    await expect(tab.client.refreshSession()).resolves.toMatchObject({ token: "after-409" });
    expect(n).toBe(2);
    expect(lost).not.toHaveBeenCalled();
  });

  it("treats a 204 (no refresh cookie) as quietly signed out, with one request", async () => {
    const { calls } = mockFetch(() => new Response(null, { status: 204 }));
    await expect(tab.client.refreshSession()).resolves.toBeNull();
    expect(calls).toHaveLength(1);
    expect(tab.client.hasAccessToken()).toBe(false);
  });

  it("turns a network failure on a normal request into a translatable error", async () => {
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    await expect(tab.client.api("/api/jobs")).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
  });
});

describe("logged-out page load (ux LOW 12)", () => {
  it("skips the refresh call once this browser is known to be logged out", async () => {
    vi.stubGlobal("navigator", { ...navigator, locks: undefined });
    const tab = await openTab();
    const { calls } = mockFetch(() => json(401, {}));
    await expect(tab.client.restoreSession()).resolves.toBeNull(); // first visit: asks once
    await expect(tab.client.restoreSession()).resolves.toBeNull(); // now known: no request
    expect(calls).toHaveLength(1);
    tab.lock.resetRefreshLockForTests();
  });
});
