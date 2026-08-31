import { createClient, type RedisClientType } from "redis";

let client: RedisClientType | null = null;
let ready = false;

const OPEN_JOBS_PREFIX = "fixlocal:jobs:open:";

export async function initCache(): Promise<void> {
  if (process.env.REDIS_ENABLED === "false") {
    console.log("Redis cache disabled (REDIS_ENABLED=false)");
    return;
  }

  const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
  try {
    client = createClient({ url });
    client.on("error", (err) => {
      console.warn("Redis error:", (err as Error).message);
      ready = false;
    });
    await client.connect();
    ready = true;
    console.log("Redis connected");
  } catch (err) {
    console.warn(
      "Redis unavailable — open-job list will hit Postgres only:",
      (err as Error).message
    );
    client = null;
    ready = false;
  }
}

export function cacheReady(): boolean {
  return ready && !!client;
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  if (!cacheReady() || !client) return null;
  try {
    const raw = await client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSetJson(
  key: string,
  value: unknown,
  ttlSec = 60
): Promise<void> {
  if (!cacheReady() || !client) return;
  try {
    await client.set(key, JSON.stringify(value), { EX: ttlSec });
  } catch {
    /* ignore */
  }
}

/** Drop all cached open-job list responses. */
export async function invalidateOpenJobsCache(): Promise<void> {
  if (!cacheReady() || !client) return;
  try {
    const keys = await client.keys(`${OPEN_JOBS_PREFIX}*`);
    if (keys.length) await client.del(keys);
  } catch {
    /* ignore */
  }
}

export function openJobsCacheKey(parts: Record<string, string>): string {
  const stable = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${parts[k]}`)
    .join("&");
  return `${OPEN_JOBS_PREFIX}${stable || "default"}`;
}

export async function closeCache(): Promise<void> {
  if (client) {
    try {
      await client.quit();
    } catch {
      /* ignore */
    }
  }
  client = null;
  ready = false;
}
