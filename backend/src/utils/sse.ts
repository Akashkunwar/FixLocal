import crypto from "crypto";
import type { Response } from "express";
import { redisPublish, redisSubscribe } from "./cache";
import { logger } from "../logger";

type SseClient = {
  id: string;
  userId: string;
  thread?: { jobId: string; tradespersonId: string };
  res: Response;
  openedAt: number;
  heartbeat: NodeJS.Timeout;
};

const clients = new Map<string, SseClient>();
const CHANNEL = "fixlocal:sse";
export const MAX_STREAMS_PER_USER = 5;
let pubsub = false;

type Envelope =
  | { kind: "notification"; userId: string; payload: unknown }
  | { kind: "message"; jobId: string; tradespersonId: string; payload: unknown }
  | { kind: "revoke"; jobId: string; keepTradespersonId: string | null };

export async function initSseFanout() {
  pubsub = await redisSubscribe(CHANNEL, (raw) => {
    try {
      deliver(JSON.parse(raw) as Envelope);
    } catch (err) {
      logger.warn({ err }, "bad SSE envelope");
    }
  });
}

function send(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function close(id: string) {
  const c = clients.get(id);
  if (!c) return;
  clearInterval(c.heartbeat);
  clients.delete(id);
  try {
    c.res.end();
  } catch {
    /* already closed */
  }
}

export function openStream(
  res: Response,
  userId: string,
  thread?: { jobId: string; tradespersonId: string }
): string {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // Cap concurrent streams per user; the oldest is closed first.
  const mine = [...clients.values()].filter((c) => c.userId === userId).sort((a, b) => a.openedAt - b.openedAt);
  while (mine.length >= MAX_STREAMS_PER_USER) {
    const oldest = mine.shift()!;
    close(oldest.id);
  }

  const id = crypto.randomUUID();
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {
      close(id);
    }
  }, 25_000);
  clients.set(id, { id, userId, thread, res, openedAt: Date.now() + clients.size / 1000, heartbeat });
  send(res, "connected", { ok: true, at: new Date().toISOString() });
  res.on("close", () => close(id));
  res.on("error", () => close(id));
  return id;
}

function deliver(env: Envelope) {
  for (const c of clients.values()) {
    try {
      if (env.kind === "revoke") {
        if (c.thread && c.thread.jobId === env.jobId && c.thread.tradespersonId !== env.keepTradespersonId) {
          close(c.id);
        }
      } else if (env.kind === "notification" && !c.thread && c.userId === env.userId) {
        send(c.res, "notification", env.payload);
      } else if (
        env.kind === "message" &&
        c.thread &&
        c.thread.jobId === env.jobId &&
        c.thread.tradespersonId === env.tradespersonId
      ) {
        send(c.res, "message", env.payload);
      }
    } catch {
      close(c.id);
    }
  }
}

async function dispatch(env: Envelope) {
  if (pubsub && (await redisPublish(CHANNEL, JSON.stringify(env)))) return;
  deliver(env);
}

export function publishNotification(userId: string, payload: unknown) {
  return dispatch({ kind: "notification", userId, payload });
}

/** Only subscribers of this (job, professional) thread receive it; access was checked at subscribe time. */
export function publishMessage(jobId: string, tradespersonId: string, payload: unknown) {
  return dispatch({ kind: "message", jobId, tradespersonId, payload });
}

/** After an award or cancellation, drop open chat streams of pros who lost access. */
export function revokeThreadStreams(jobId: string, keepTradespersonId: string | null) {
  return dispatch({ kind: "revoke", jobId, keepTradespersonId });
}

export function streamCount(userId?: string) {
  if (!userId) return clients.size;
  return [...clients.values()].filter((c) => c.userId === userId).length;
}

export function closeAllStreams() {
  for (const id of [...clients.keys()]) close(id);
}
