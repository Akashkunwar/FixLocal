import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlePreloadError } from "./chunkReload";

describe("reload once on a missing chunk after a deploy", () => {
  beforeEach(() => sessionStorage.clear());

  it("reloads the first time and not again within a minute", () => {
    const reload = vi.fn();
    expect(handlePreloadError(new Event("vite:preloadError", { cancelable: true }), 1_000_000, reload)).toBe(true);
    expect(handlePreloadError(new Event("vite:preloadError", { cancelable: true }), 1_030_000, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads again after the window has passed", () => {
    const reload = vi.fn();
    handlePreloadError(new Event("x", { cancelable: true }), 1_000_000, reload);
    handlePreloadError(new Event("x", { cancelable: true }), 1_100_000, reload);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
