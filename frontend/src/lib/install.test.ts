import { describe, expect, it, vi } from "vitest";
import { dismissedRecently, INSTALL_DISMISS_KEY, isIosSafari, listenForInstallPrompt, promptInstall } from "./install";

describe("install prompt", () => {
  it("captures the browser event and prompts once", async () => {
    const target = new EventTarget() as unknown as Window;
    listenForInstallPrompt(target);
    expect(await promptInstall()).toBe(false);
    const prompt = vi.fn(async () => undefined);
    const ev = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    target.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(await promptInstall()).toBe(true);
    expect(await promptInstall()).toBe(false);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("spots iPhone Safari but not Chrome on iOS", () => {
    expect(isIosSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Mobile/15E148 Safari/604.1")).toBe(true);
    expect(isIosSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/120 Mobile Safari/604.1")).toBe(false);
    expect(isIosSafari("Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36")).toBe(false);
  });

  it("keeps a dismissal for 30 days", () => {
    const now = Date.UTC(2026, 9, 26);
    const store = (v: string | null) => ({ getItem: (k: string) => (k === INSTALL_DISMISS_KEY ? v : null) });
    expect(dismissedRecently(now, store(null))).toBe(false);
    expect(dismissedRecently(now, store(String(now - 29 * 86_400_000)))).toBe(true);
    expect(dismissedRecently(now, store(String(now - 31 * 86_400_000)))).toBe(false);
  });
});
