/**
 * Cross-tab coordination for the refresh-token rotation (fe-logic CRIT 1).
 *
 * Every tab shares one refresh cookie. If two tabs rotate it at the same time, the second sends a
 * token the first just retired and the server treats that as reuse and revokes the whole session.
 * So only one tab refreshes at a time:
 *  - Web Locks (`navigator.locks`) serialise the refresh across tabs when available;
 *  - otherwise a short-lived lock record in localStorage does the same job.
 * The tab that refreshed posts the result on a BroadcastChannel, and a tab that was waiting for the
 * lock reuses it instead of rotating again. Only a timestamp touches localStorage, never a token.
 */

const LOCK_NAME = "fixlocal-auth-refresh";
const CHANNEL_NAME = "fixlocal-auth";
const STORAGE_LOCK_KEY = "fixlocal-auth:refresh-lock";
const STORAGE_DONE_KEY = "fixlocal-auth:refreshed-at";
/** How long a storage lock may be held before another tab may take it over. */
const STORAGE_LOCK_TTL_MS = 12_000;

export type Shared<T> = { at: number; value: T };

type Message<T> = { type: "refreshed"; at: number; value: T };

let channel: BroadcastChannel | null | undefined;
let lastShared: Shared<unknown> | null = null;
const waiters = new Set<() => void>();

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;
  } catch {
    channel = null;
  }
  channel?.addEventListener("message", (e: MessageEvent<Message<unknown>>) => {
    if (e.data?.type !== "refreshed") return;
    lastShared = { at: e.data.at, value: e.data.value };
    waiters.forEach((w) => w());
  });
  return channel;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the in-tab lock still applies */
  }
}

/** Fallback mutex for browsers without Web Locks: a lock record with an owner id and expiry. */
async function withStorageLock<T>(fn: () => Promise<T>): Promise<T> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const giveUpAt = Date.now() + STORAGE_LOCK_TTL_MS + 2_000;
  const read = () => {
    try {
      return JSON.parse(readStorage(STORAGE_LOCK_KEY) || "null") as { id: string; until: number } | null;
    } catch {
      return null;
    }
  };
  let owned = false;
  while (!owned && Date.now() < giveUpAt) {
    const cur = read();
    if (!cur || cur.until < Date.now()) {
      writeStorage(STORAGE_LOCK_KEY, JSON.stringify({ id, until: Date.now() + STORAGE_LOCK_TTL_MS }));
      await sleep(25); // let a racing tab's write land, then see who won
      owned = read()?.id === id;
      if (owned) break;
    }
    await sleep(40 + Math.random() * 60);
  }
  try {
    return await fn();
  } finally {
    if (read()?.id === id) writeStorage(STORAGE_LOCK_KEY, null);
  }
}

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (locks?.request) return locks.request(LOCK_NAME, { mode: "exclusive" }, fn) as Promise<T>;
  return withStorageLock(fn);
}

/** Wait briefly for another tab's broadcast that is known to be on its way. */
function waitForShared(since: number, ms: number): Promise<Shared<unknown> | null> {
  if (lastShared && lastShared.at >= since) return Promise.resolve(lastShared);
  return new Promise((resolve) => {
    const done = () => {
      if (lastShared && lastShared.at >= since) {
        waiters.delete(done);
        clearTimeout(timer);
        resolve(lastShared);
      }
    };
    const timer = setTimeout(() => {
      waiters.delete(done);
      resolve(null);
    }, ms);
    waiters.add(done);
  });
}

/**
 * Run `refresh` with the cross-tab lock held. If another tab finished a refresh while this one was
 * waiting for the lock, its result is returned instead and `refresh` is not called.
 */
export async function runExclusiveRefresh<T>(refresh: () => Promise<T>): Promise<T> {
  getChannel();
  const askedAt = Date.now();
  return withLock(async () => {
    const doneAt = Number(readStorage(STORAGE_DONE_KEY) || 0);
    if (doneAt >= askedAt || (lastShared && lastShared.at >= askedAt)) {
      // Another tab refreshed while we queued. Its message may still be in flight.
      const shared = await waitForShared(askedAt, 400);
      if (shared) return shared.value as T;
      // No message (old tab, channel unavailable): refreshing is still safe now, because the lock
      // means the cookie jar already holds the other tab's new refresh token.
    }
    const value = await refresh();
    const at = Date.now();
    lastShared = { at, value };
    writeStorage(STORAGE_DONE_KEY, String(at));
    try {
      getChannel()?.postMessage({ type: "refreshed", at, value } satisfies Message<T>);
    } catch {
      /* unserialisable or closed channel: other tabs refresh on their own, one at a time */
    }
    return value;
  });
}

/** Test hook: forget shared state between tests. */
export function resetRefreshLockForTests() {
  lastShared = null;
  waiters.clear();
  channel?.close();
  channel = undefined;
}
