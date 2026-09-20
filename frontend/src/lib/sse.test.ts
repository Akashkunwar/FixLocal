import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openSse } from "./sse";
import { setAccessToken } from "../api/client";
import { json, mockFetch } from "../test/http";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  listeners: Record<string, (e: MessageEvent) => void> = {};
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: (e: MessageEvent) => void) {
    this.listeners[name] = fn;
  }
  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  setAccessToken("tok");
});
afterEach(() => vi.useRealTimers());

describe("openSse (H-1: no token in URLs)", () => {
  it("connects with a one-time ticket, never the access token", async () => {
    mockFetch((url) => (url.endsWith("/api/auth/sse-ticket") ? json(200, { ticket: "t-1", expiresIn: 30 }) : undefined));
    const onEvent = vi.fn();
    const s = openSse("/api/messages/j1/stream?pro=p1", { onEvent });
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe("/api/messages/j1/stream?pro=p1&ticket=t-1");
    expect(es.url).not.toContain("tok");
    es.listeners.message({ data: JSON.stringify({ message: { id: "m1" } }) } as MessageEvent);
    expect(onEvent).toHaveBeenCalledWith("message", { message: { id: "m1" } });
    s.close();
    expect(es.closed).toBe(true);
  });

  it("reports denial and stops when a ticket is refused", async () => {
    const { fn } = mockFetch((url) =>
      url.endsWith("/api/auth/refresh") ? json(401, {}) : json(401, { code: "UNAUTHORIZED" })
    );
    const onDenied = vi.fn();
    openSse("/api/notifications/stream", { onDenied });
    await vi.waitFor(() => expect(onDenied).toHaveBeenCalled());
    const count = fn.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(fn.mock.calls.length).toBe(count);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("reconnects with a fresh ticket after the stream drops", async () => {
    vi.useFakeTimers();
    let n = 0;
    mockFetch((url) => (url.endsWith("/api/auth/sse-ticket") ? json(200, { ticket: `t-${++n}`, expiresIn: 30 }) : undefined));
    const s = openSse("/api/notifications/stream");
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0].onerror?.();
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(FakeEventSource.instances[1].url).toContain("ticket=t-2");
    s.close();
  });
});
