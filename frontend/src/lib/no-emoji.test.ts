import { describe, expect, it } from "vitest";

/**
 * The UI uses flat line icons (lucide-react, see components/CategoryIcon.tsx), never emoji.
 * Scans frontend source and styles, the HTML shell and PWA files; backend/test/no-emoji.test.ts
 * covers emails, texts, notification titles and seed data. ©, ® and ™ are ordinary text.
 */
const SOURCES = import.meta.glob<string>(
  [
    "../**/*.{ts,tsx,css}",
    "!../**/no-emoji.test.ts",
    "../../index.html",
    "../../public/**/*.{json,webmanifest,svg,html}",
  ],
  { query: "?raw", import: "default", eager: true },
);
const EMOJI = /(?![©®™])\p{Extended_Pictographic}|[\u2605\u2606\uFE0F\u20E3]/u;

describe("no emoji in the UI", () => {
  it("scans the frontend source and the HTML shell", () => {
    const files = Object.keys(SOURCES);
    expect(files.some((f) => f.endsWith("index.html"))).toBe(true);
    expect(files.length).toBeGreaterThan(150);
  });

  it("finds no emoji in user-facing source", () => {
    const hits: string[] = [];
    for (const [file, text] of Object.entries(SOURCES)) {
      text.split("\n").forEach((line, i) => {
        const m = line.match(EMOJI);
        if (m) hits.push(`${file}:${i + 1} ${m[0]}`);
      });
    }
    expect(hits, "use a lucide-react icon (aria-hidden) instead of an emoji").toEqual([]);
  });

  it("catches emoji and allows ordinary symbols", () => {
    for (const s of ["🔧", "⚡", "🏗️", "★", "✔"]) expect(EMOJI.test(s), s).toBe(true);
    for (const s of ["©", "™", "→", "₹", "·", "—", "नमस्ते"]) expect(EMOJI.test(s), s).toBe(false);
  });
});
