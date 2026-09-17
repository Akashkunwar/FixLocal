import { describe, expect, it } from "vitest";
import { nameFromRef, normalizeRef, signedUrl, verifySignedUrl } from "../../src/services/files";
import { normalizeTemplates } from "../../src/validation/templates";

describe("file references", () => {
  it("accepts only server file refs", () => {
    expect(nameFromRef("/api/files/abc.png")).toBe("abc.png");
    expect(nameFromRef("/api/files/abc.png?exp=1&sig=x")).toBe("abc.png");
    expect(nameFromRef("/api/files/../etc/passwd")).toBeNull();
    expect(nameFromRef("https://evil.example/a.png")).toBeNull();
    expect(nameFromRef("javascript:alert(1)")).toBeNull();
    expect(nameFromRef(42)).toBeNull();
    expect(normalizeRef("/api/files/a.png?sig=1")).toBe("/api/files/a.png");
  });

  it("signs and verifies URLs with expiry", () => {
    const url = signedUrl("/api/files/a.png", Date.UTC(2026, 0, 1))!;
    const params = new URL(url, "http://x").searchParams;
    expect(verifySignedUrl("a.png", params.get("exp"), params.get("sig"))).toBe(false); // expired (2026-01-01)
    const fresh = signedUrl("/api/files/a.png")!;
    const p2 = new URL(fresh, "http://x").searchParams;
    expect(verifySignedUrl("a.png", p2.get("exp"), p2.get("sig"))).toBe(true);
    expect(verifySignedUrl("b.png", p2.get("exp"), p2.get("sig"))).toBe(false);
    expect(verifySignedUrl("a.png", Number(p2.get("exp")) + 1, p2.get("sig"))).toBe(false);
    expect(signedUrl("https://evil.example/x")).toBeNull();
  });
});

describe("template normalization", () => {
  it("trims, caps and drops empty templates", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ label: `L${i}`, body: i === 0 ? "   " : "x".repeat(900) }));
    const out = normalizeTemplates("counter", items);
    expect(out).toHaveLength(19);
    expect((out[0].body as string).length).toBe(500);
    expect(normalizeTemplates("namedJob", [{ name: "N" }, { name: "N", title: "T", siteType: "castle" }])).toEqual([
      expect.not.objectContaining({ siteType: expect.anything() }),
    ]);
  });
});
