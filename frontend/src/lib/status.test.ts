import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STATUS_CLASSES, statusLabel } from "./status";
import { loadHindi, setCurrentLang } from "./t";

describe("statusLabel", () => {
  beforeAll(async () => {
    await loadHindi();
    setCurrentLang("hi");
  });
  afterAll(() => setCurrentLang("en"));

  it("has Hindi for every status that gets a badge colour", () => {
    const untranslated = Object.keys(STATUS_CLASSES).filter((k) => !/[\u0900-\u097F]/.test(statusLabel(k)));
    expect(untranslated).toEqual([]);
  });

  it("never shows a raw snake_case key in English", () => {
    setCurrentLang("en");
    for (const k of Object.keys(STATUS_CLASSES)) expect(statusLabel(k)).not.toMatch(/_/);
    setCurrentLang("hi");
  });
});
