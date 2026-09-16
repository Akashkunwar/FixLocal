import { API_URL, getToken } from "../api/client";

export type SseHandlers = {
  onEvent?: (event: string, data: unknown) => void;
  onOpen?: () => void;
  onError?: () => void;
};

/**
 * Open an EventSource with ?token= (EventSource cannot set Authorization).
 * Returns close() and whether the browser supports EventSource.
 */
export function openSse(path: string, handlers: SseHandlers = {}) {
  if (typeof EventSource === "undefined") {
    handlers.onError?.();
    return { close: () => undefined, supported: false as const };
  }
  const token = getToken();
  if (!token) {
    handlers.onError?.();
    return { close: () => undefined, supported: false as const };
  }
  const sep = path.includes("?") ? "&" : "?";
  const url = `${API_URL}${path}${sep}token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);

  es.onopen = () => handlers.onOpen?.();
  es.onerror = () => handlers.onError?.();

  const wrap = (event: string) => (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      handlers.onEvent?.(event, data);
    } catch {
      handlers.onEvent?.(event, e.data);
    }
  };

  es.addEventListener("notification", wrap("notification"));
  es.addEventListener("message", wrap("message"));
  es.addEventListener("connected", wrap("connected"));

  return {
    close: () => {
      try {
        es.close();
      } catch {
        /* ignore */
      }
    },
    supported: true as const,
    es,
  };
}
