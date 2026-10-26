import { describe, expect, it } from "vitest";
import { criteriaOf, describeAlert, type AlertDraft } from "./jobAlerts";

const draft: AlertDraft = { name: "", categories: ["plumbing"], city: " Bengaluru ", area: "", radiusKm: "5", minBudget: "1000", siteType: "" };

describe("job alerts", () => {
  it("only sends a radius when the pro has a base location", () => {
    expect(criteriaOf(draft, null)).toMatchObject({ radiusKm: null, lat: null, lng: null, city: "Bengaluru", minBudget: 1000 });
    expect(criteriaOf(draft, { lat: 12.9, lng: 77.6 })).toMatchObject({ radiusKm: 5, lat: 12.9, lng: 77.6 });
    expect(criteriaOf({ ...draft, minBudget: "", area: " " }, null)).toMatchObject({ minBudget: null, area: null });
  });

  it("describes an alert in one line", () => {
    expect(describeAlert(criteriaOf(draft, { lat: 1, lng: 1 }))).toMatch(/^Plumbing · within 5 km of your base · ₹1,000\+ budget$/);
    expect(describeAlert(criteriaOf({ ...draft, categories: [], radiusKm: "", minBudget: "", siteType: "office" }, null))).toBe(
      "Any category · Bengaluru · offices"
    );
  });
});
