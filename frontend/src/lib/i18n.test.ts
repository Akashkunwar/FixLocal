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

/**
 * Text that reads the same in both languages (brand names, admin weight codes): wrapped in t() so
 * the raw-text check stays simple, but deliberately left out of the Hindi dictionary.
 */
const LANGUAGE_NEUTRAL = new Set([
  "FixLocal",
  "WhatsApp",
  "rankedScore",
  "sk",
  "·rt",
  "·rs",
  "·ds",
  "/rt",
  "/rs",
  "/ds",
  "/px",
  "/sh{slaHeatPct}",
  " + {slaHeatPct}% × slaHeatNorm ({slaHeatNorm})",
  "admin ok",
]);
const hasWords = (s: string) => /[A-Za-z]{2,}/.test(s.replace(/\{\w+\}/g, ""));

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

  it('has a Hindi entry for every t("…"), tf("…"), plural("…", "…") and errorText(…, "…") literal in the app', () => {
    const missing = new Set<string>();
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    const STR = String.raw`"((?:[^"\\]|\\.)+)"`;
    const patterns = [
      new RegExp(String.raw`\bt\(\s*` + STR + String.raw`\s*\)`, "g"),
      new RegExp(String.raw`\btf\(\s*` + STR + String.raw`\s*,`, "g"),
      new RegExp(String.raw`\bplural\(\s*[^,]+,\s*` + STR + String.raw`\s*,\s*` + STR, "g"),
      new RegExp(String.raw`\berrorText\(\s*[^,()]+,\s*` + STR + String.raw`\s*\)`, "g"),
    ];
    for (const text of Object.values(SOURCES)) {
      for (const re of patterns) {
        for (const m of text.matchAll(re)) {
          for (const key of m.slice(1)) {
            if (key === undefined) continue;
            const k = JSON.parse(`"${key}"`) as string;
            if (!(k in HI) && hasWords(k) && !LANGUAGE_NEUTRAL.has(k)) missing.add(k);
          }
        }
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("keeps placeholders intact in every Hindi template", () => {
    for (const [en, hi] of Object.entries(HI)) {
      const want = (en.match(/\{\w+\}/g) || []).sort();
      const got = (hi.match(/\{\w+\}/g) || []).sort();
      expect(got, en).toEqual(want);
    }
  });

  it("only translates into Devanagari (no English left in the Hindi values by mistake)", () => {
    for (const [en, hi] of Object.entries(HI)) {
      expect(hi, en).toMatch(/[\u0900-\u097F]/);
    }
  });
});
