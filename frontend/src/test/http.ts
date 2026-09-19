import { vi } from "vitest";

export type Route = (url: string, init: RequestInit) => Response | undefined | Promise<Response | undefined>;

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Replace fetch with a router; unmatched requests fail the test loudly. */
export function mockFetch(route: Route) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const res = await route(url, init);
    if (!res) throw new Error(`Unexpected request: ${init.method || "GET"} ${url}`);
    return res;
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

export const authHeader = (init: RequestInit) => new Headers(init.headers).get("Authorization");
