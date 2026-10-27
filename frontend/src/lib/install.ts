import { useSyncExternalStore } from "react";

/** Chrome/Edge/Samsung's install event (not in the TS DOM lib). */
export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export const INSTALL_DISMISS_KEY = "fixlocal:install-dismissed";
const DISMISS_DAYS = 30;

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Call once at start-up: the browser fires the event early and only once per page load. */
export function listenForInstallPrompt(win: Window = window) {
  win.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep the mini-infobar away; we show our own button
    deferred = e as InstallPromptEvent;
    emit();
  });
  win.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}

export function isIosSafari(ua: string): boolean {
  const ios = /iPhone|iPad|iPod/.test(ua);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export function isStandalone(win: Window = window): boolean {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || win.matchMedia?.("(display-mode: standalone)").matches === true;
}

export function dismissedRecently(now = Date.now(), storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try {
    const at = Number(storage.getItem(INSTALL_DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && now - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

export function rememberDismissal(now = Date.now()) {
  try {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(now));
  } catch {
    /* private mode: the banner may come back next visit */
  }
}

/** Shows the browser's install dialog. Resolves true when the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null; // an event can be prompted only once
  emit();
  await e.prompt();
  const choice = await e.userChoice;
  if (choice.outcome === "accepted") installed = true;
  emit();
  return choice.outcome === "accepted";
}

type InstallState = { canPrompt: boolean; installed: boolean };
let snapshot: InstallState = { canPrompt: false, installed: false };
function getSnapshot(): InstallState {
  if (snapshot.canPrompt !== !!deferred || snapshot.installed !== installed) {
    snapshot = { canPrompt: !!deferred, installed };
  }
  return snapshot;
}

export function useInstallPrompt(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSnapshot,
    getSnapshot
  );
}
