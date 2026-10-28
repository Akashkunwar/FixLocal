import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { errorText } from "./apiErrors";
import { loadHindi, setCurrentLang } from "./t";

const apiError = (status: number, message: string, code?: string) => new ApiError(message, status, code);

describe("errorText", () => {
  beforeAll(() => loadHindi());
  afterAll(() => setCurrentLang("en"));

  it("keeps a specific validation reason from the server", () => {
    setCurrentLang("en");
    expect(errorText(apiError(400, "Budget is outside the allowed range", "VALIDATION"))).toBe("Budget is outside the allowed range");
  });

  it("replaces a catch-all message with a helpful sentence", () => {
    setCurrentLang("en");
    expect(errorText(apiError(400, "Invalid request", "VALIDATION"))).toMatch(/aren't valid/);
    expect(errorText(apiError(404, "Route not found: GET /x", "ROUTE_NOT_FOUND"))).toBe("That page or action doesn't exist.");
  });

  it("translates known server messages and codes into Hindi", () => {
    setCurrentLang("hi");
    expect(errorText(apiError(401, "Invalid email or password"))).toBe("ईमेल या पासवर्ड ग़लत है");
    expect(errorText(apiError(429, "Slow down there", "RATE_LIMITED"))).toMatch(/[\u0900-\u097F]/);
    expect(errorText(new Error("boom"), "Upload failed")).toBe("boom");
    expect(errorText("weird", "Upload failed")).toBe("अपलोड नहीं हो सका");
  });
});
