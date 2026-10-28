import { afterEach, describe, expect, it } from "vitest";
import { fmtDateTime, fmtTime, moneyExact, setDisplayTimeZone } from "./format";

afterEach(() => setDisplayTimeZone(null));

describe("dates follow the user's time zone", () => {
  const iso = "2026-01-10T18:45:00Z"; // 00:15 on 11 Jan in IST

  it("defaults to India time", () => {
    expect(fmtDateTime(iso)).toMatch(/11 Jan/);
    expect(fmtTime(iso)).toMatch(/12:15|00:15/);
  });

  it("uses the zone from Settings", () => {
    setDisplayTimeZone("Europe/London");
    expect(fmtDateTime(iso)).toMatch(/10 Jan/);
    expect(fmtTime(iso)).toMatch(/06:45/);
  });

  it("falls back to India time for an unknown zone", () => {
    setDisplayTimeZone("Mars/Base");
    expect(fmtDateTime(iso)).toMatch(/11 Jan/);
  });
});

describe("moneyExact", () => {
  it("shows paise only when there are any", () => {
    expect(moneyExact(299.7)).toBe("₹299.70");
    expect(moneyExact("1200")).toBe("₹1,200");
  });
});
