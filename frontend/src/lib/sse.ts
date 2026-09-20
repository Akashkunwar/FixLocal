import { API_URL, getSseTicket, hasAccessToken, refreshSession } from "../api/client";

export type SseHandlers = {
  onEvent?: (event: string, data: unknown) => void;
  onOpen?: () => void;
  onError?: () => void;
  /** The server refused the stream (no access); stop retrying. */
  onDenied?: () => void;
};

const MAX_BACKOFF_MS = 60_000;

/**
 * Live updates over EventSource. EventSource can't send headers, so each connection
 * uses a one-time ticket from POST /api/auth/sse-ticket; reconnects fetch a new one.
 */
export function openSse(path: string, handlers: SseHandlers = {}) {
  if (typeof EventSource === "undefined") {
    handlers.onError?.();
    return { close: () => undefined, supported: false as const };
  }
  let es: EventSource | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const wrap = (event: string) => (e: MessageEvent) => {
    try {
      handlers.onEvent?.(event, JSON.parse(e.data));
    } catch {
      handlers.onEvent?.(event, e.data);
    }
  };

  const schedule = () => {
    if (closed) return;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
    attempt += 1;
    timer = setTimeout(connect, delay);
  };

  async function connect() {
    if (closed) return;
    try {
      if (!hasAccessToken()) await refreshSession();
      const { ticket } = await getSseTicket();
      if (closed) return;
      const sep = path.includes("?") ? "&" : "?";
      es = new EventSource(`${API_URL}${path}${sep}ticket=${encodeURIComponent(ticket)}`, { withCredentials: true });
      es.onopen = () => {
        attempt = 0;
        handlers.onOpen?.();
      };
      es.onerror = () => {
        es?.close();
        es = null;
        handlers.onError?.();
        schedule();
      };
      es.addEventListener("notification", wrap("notification"));
      es.addEventListener("message", wrap("message"));
      es.addEventListener("connected", wrap("connected"));
    } catch (err) {
      handlers.onError?.();
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        handlers.onDenied?.();
        return;
      }
      schedule();
    }
  }

  void connect();

  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      es?.close();
    },
    supported: true as const,
  };
}
