import { Response } from "express";

type SseClient = {
  id: string;
  userId: string;
  jobId?: string;
  res: Response;
};

const clients = new Map<string, SseClient>();

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function sseInit(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  // Flush headers if available
  (res as any).flushHeaders?.();
}

export function sseSend(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function sseSubscribe(
  res: Response,
  userId: string,
  opts: { jobId?: string } = {}
): string {
  const id = genId();
  clients.set(id, { id, userId, jobId: opts.jobId, res });
  sseSend(res, "connected", { ok: true, at: new Date().toISOString() });

  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  const cleanup = () => {
    clearInterval(heartbeat);
    clients.delete(id);
  };
  res.on("close", cleanup);
  res.on("error", cleanup);
  return id;
}

export function publishNotification(userId: string, payload: unknown) {
  for (const c of clients.values()) {
    if (c.userId !== userId) continue;
    if (c.jobId) continue; // job streams only get message events
    try {
      sseSend(c.res, "notification", payload);
    } catch {
      /* client gone */
    }
  }
}

export function publishMessage(jobId: string, payload: unknown) {
  for (const c of clients.values()) {
    if (c.jobId !== jobId) continue;
    try {
      sseSend(c.res, "message", payload);
    } catch {
      /* client gone */
    }
  }
}

export function sseClientCount() {
  return clients.size;
}
