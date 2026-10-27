import { logger } from "../logger";

export type ErrorContext = Record<string, unknown>;
export type ErrorReporter = (err: unknown, context: ErrorContext) => void | Promise<void>;

/**
 * Error-tracking hook. Default: nothing beyond the structured log line.
 * Set ERROR_WEBHOOK_URL to POST a compact JSON payload (Slack/Discord-style webhooks, a
 * Sentry relay, …), or call setErrorReporter() to plug in an SDK.
 */
let reporter: ErrorReporter | null = null;

function webhookReporter(url: string): ErrorReporter {
  return async (err, context) => {
    const e = err instanceof Error ? err : new Error(String(err));
    const body = {
      text: `FixLocal API error: ${e.message}`.slice(0, 500),
      error: { name: e.name, message: e.message, stack: e.stack?.split("\n").slice(0, 8).join("\n") },
      context,
      env: process.env.NODE_ENV,
      at: new Date().toISOString(),
    };
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
  };
}

export function setErrorReporter(r: ErrorReporter | null) {
  reporter = r;
}

export function initErrorReporter(url = process.env.ERROR_WEBHOOK_URL) {
  if (url) reporter = webhookReporter(url);
}

/** Fire-and-forget: never throws, never blocks the request. */
export function reportError(err: unknown, context: ErrorContext = {}) {
  if (!reporter) return;
  try {
    Promise.resolve(reporter(err, context)).catch((e) => logger.warn({ err: e }, "error reporter failed"));
  } catch (e) {
    logger.warn({ err: e }, "error reporter failed");
  }
}
