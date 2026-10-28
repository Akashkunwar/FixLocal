const KEY = "fixlocal:chunk-reload-at";
const WINDOW_MS = 60_000;

/**
 * After a deploy, an open tab may ask for a code chunk that no longer exists. Vite then fires
 * `vite:preloadError`; reload once to pick up the new build. A second failure within a minute is
 * left to the error boundary so a real outage can't cause a reload loop.
 */
export function handlePreloadError(event: Event, now = Date.now(), reload = () => window.location.reload()): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY)) || 0;
  } catch {
    /* storage blocked: still reload once */
  }
  if (now - last < WINDOW_MS) return false;
  try {
    sessionStorage.setItem(KEY, String(now));
  } catch {
    /* ignore */
  }
  event.preventDefault();
  reload();
  return true;
}

export function installChunkReload() {
  window.addEventListener("vite:preloadError", (e) => handlePreloadError(e));
}
