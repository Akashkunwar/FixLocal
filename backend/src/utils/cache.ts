import { createClient, type RedisClientType } from "redis";
import { config } from "../config";
import { logger } from "../logger";

let client: RedisClientType | null = null;
let subscriber: RedisClientType | null = null;
let ready = false;

const OPEN_JOBS_PREFIX = "fixlocal:jobs:open:";
const OPEN_JOBS_VERSION_KEY = "fixlocal:jobs:open:ver";

export async function initCache(): Promise<void> {
  const cfg = config();
  if (!cfg.redisEnabled) {
    logger.info("Redis disabled (REDIS_ENABLED=false)");
    return;
  }
  try {
    client = createClient({ url: cfg.redisUrl });
    client.on("error", (err) => {
      logger.warn({ err: (err as Error).message }, "Redis error");
      ready = false;
    });
    client.on("ready", () => {
      ready = true;
    });
    await client.connect();
    ready = true;
    logger.info("Redis connected");
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Redis unavailable; continuing without cache");
    client = null;
    ready = false;
  }
}

export function cacheReady(): boolean {
  return ready && !!client;
}

export function redisClient(): RedisClientType | null {
  return cacheReady() ? client : null;
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

export async function cacheSetJson(key: string, value: unknown, ttlSec = 60): Promise<void> {
  if (!cacheReady() || !client) return;
  try {
    await client.set(key, JSON.stringify(value), { EX: ttlSec });
  } catch {
    /* cache is best-effort */
  }
}

export async function cacheDel(key: string): Promise<void> {
  if (!cacheReady() || !client) return;
  try {
    await client.del(key);
  } catch {
    /* cache is best-effort */
  }
}

async function openJobsVersion(): Promise<string> {
  if (!cacheReady() || !client) return "0";
  try {
    return (await client.get(OPEN_JOBS_VERSION_KEY)) || "0";
  } catch {
    return "0";
  }
}

/** Bumps the namespace version; old keys simply expire (no KEYS scan). */
export async function invalidateOpenJobsCache(): Promise<void> {
  if (!cacheReady() || !client) return;
  try {
    await client.incr(OPEN_JOBS_VERSION_KEY);
  } catch {
    /* cache is best-effort */
  }
}

export async function openJobsCacheKey(parts: Record<string, unknown>): Promise<string> {
  const stable = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${parts[k] ?? ""}`)
    .join("&");
  const ver = await openJobsVersion();
  return `${OPEN_JOBS_PREFIX}v${ver}:${stable}`;
}

/** Pub/sub for fan-out across API instances (SSE). */
export async function redisSubscribe(channel: string, handler: (message: string) => void): Promise<boolean> {
  if (!cacheReady() || !client) return false;
  try {
    subscriber = client.duplicate();
    subscriber.on("error", (err) => logger.warn({ err: (err as Error).message }, "Redis subscriber error"));
    await subscriber.connect();
    await subscriber.subscribe(channel, handler);
    return true;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Redis subscribe failed");
    subscriber = null;
    return false;
  }
}

export async function redisPublish(channel: string, message: string): Promise<boolean> {
  if (!cacheReady() || !client || !subscriber) return false;
  try {
    await client.publish(channel, message);
    return true;
  } catch {
    return false;
  }
}

export async function flushTestCache(): Promise<void> {
  if (!cacheReady() || !client) return;
  await client.flushDb();
}

export async function closeCache(): Promise<void> {
  for (const c of [subscriber, client]) {
    if (!c) continue;
    try {
      await c.quit();
    } catch {
      /* ignore */
    }
  }
  subscriber = null;
  client = null;
  ready = false;
}
