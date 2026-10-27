import { describe, expect, it } from "vitest";
import { isValidGstin, normalizeGstin } from "./gstin";

describe("GSTIN", () => {
  it("accepts real-format GSTINs and rejects typos", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isValidGstin(" 29aagcb7383j1z4 ")).toBe(true);
    expect(isValidGstin("27AAPFU0939F1ZX")).toBe(false);
    expect(isValidGstin("27AAPFU0939F1Z")).toBe(false);
    expect(isValidGstin("40AAPFU0939F1ZV")).toBe(false);
    expect(normalizeGstin("27 aapfu 0939f1zv")).toBe("27AAPFU0939F1ZV");
  });
});
