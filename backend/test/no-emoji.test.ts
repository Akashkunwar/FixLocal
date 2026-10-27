import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Emails, texts, notification titles and seed data use plain text, never emoji (see frontend/src/lib/no-emoji.test.ts). */
const EMOJI = /(?![©®™])\p{Extended_Pictographic}|[\u2605\u2606\uFE0F\u20E3]/u;
const SRC = path.join(__dirname, "../src");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(ts|html|json)$/.test(e.name) ? [p] : [];
  });
}

describe("no emoji in user-facing backend text", () => {
  it("finds none in backend/src", () => {
    const hits: string[] = [];
    for (const f of files(SRC)) {
      fs.readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const m = line.match(EMOJI);
          if (m) hits.push(`${path.relative(SRC, f)}:${i + 1} ${m[0]}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
