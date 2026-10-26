import { beforeAll, describe, expect, it } from "vitest";
import { loadHindi, translate } from "./i18n";
import { HI } from "./i18n-hi";

const SOURCES = import.meta.glob<string>(
  ["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}"],
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
);

describe("i18n", () => {
  beforeAll(() => loadHindi());
  it("falls back to English for anything untranslated", () => {
    expect(translate("hi", "Log in")).toBe("लॉग इन");
    expect(translate("en", "Log in")).toBe("Log in");
    expect(translate("hi", "Some new sentence")).toBe("Some new sentence");
    expect(translate("hi", "New job: Fix the geyser")).toBe(
      "नया काम: Fix the geyser",
    );
  });

  it('has a Hindi entry for every t("…") literal in the app', () => {
    const missing = new Set<string>();
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    for (const text of Object.values(SOURCES)) {
      for (const m of text.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)+)"\s*\)/g)) {
        if (!(m[1] in HI)) missing.add(m[1]);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("only translates into Devanagari (no English left in the Hindi values by mistake)", () => {
    for (const [en, hi] of Object.entries(HI)) {
      expect(hi, en).toMatch(/[\u0900-\u097F]/);
    }
  });
});
