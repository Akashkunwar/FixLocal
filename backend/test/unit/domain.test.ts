import { describe, expect, it } from "vitest";
import { JobStatus } from "../../src/entities/Job";
import { MilestoneStatus } from "../../src/entities/PaymentMilestone";
import { PaymentStatus } from "../../src/entities/Job";
import { canTransition, TRANSITIONS } from "../../src/domain/jobStateMachine";
import { escrowAmountFromBid, paymentStatusFor, splitEscrow } from "../../src/domain/escrow";
import { matchingKeywords, tagMatchesCategory, textMatchesCategory } from "../../src/domain/categories";
import { mean, median, rate } from "../../src/domain/analytics";
import { localDatesAhead, monthKeyInZone } from "../../src/domain/time";
import { buildAvailabilityHeat, shortlistInviteBlockedByHeat } from "../../src/utils/availabilityHeat";
import { skillOverlapScore } from "../../src/utils/matchScore";
import { haversineKm, parseCoordPair } from "../../src/utils/geo";
import { sniff } from "../../src/services/files";
import { loadConfig } from "../../src/config";

describe("job state machine", () => {
  const all = Object.values(JobStatus);
  const expected: Record<string, JobStatus[]> = {
    award: [JobStatus.OPEN],
    start: [JobStatus.AWARDED],
    mark_done: [JobStatus.IN_PROGRESS],
    confirm: [JobStatus.AWARDED, JobStatus.IN_PROGRESS, JobStatus.PENDING_CONFIRMATION],
    auto_confirm: [JobStatus.PENDING_CONFIRMATION],
    cancel: [JobStatus.OPEN],
    dispute: [JobStatus.AWARDED, JobStatus.IN_PROGRESS, JobStatus.PENDING_CONFIRMATION, JobStatus.COMPLETED],
    resolve_cancel: [JobStatus.DISPUTED],
    resolve_complete: [JobStatus.DISPUTED],
  };
  for (const [action, allowed] of Object.entries(expected)) {
    it(`${action} is allowed only from ${allowed.join(", ")}`, () => {
      for (const s of all) {
        expect(canTransition(s, action as keyof typeof TRANSITIONS), `${action} from ${s}`).toBe(allowed.includes(s));
      }
    });
  }
  it("terminal states can't be force-cancelled", () => {
    expect(canTransition(JobStatus.COMPLETED, "force_cancel")).toBe(false);
    expect(canTransition(JobStatus.CANCELLED, "force_cancel")).toBe(false);
    expect(canTransition(JobStatus.DISPUTED, "force_cancel")).toBe(true);
  });
});

describe("escrow math", () => {
  it("splits 30/40/30 and always sums to the total", () => {
    for (const total of [1, 99.99, 1000, 1001, 123456.78, 0.03]) {
      const s = splitEscrow(total);
      const sum = Math.round(s.milestones.reduce((a, m) => a + m.amount, 0) * 100) / 100;
      expect(sum).toBe(Math.round(total * 100) / 100);
    }
    expect(splitEscrow(1001).milestones.map((m) => m.amount)).toEqual([300.3, 400.4, 300.3]);
    expect(splitEscrow(-5).milestones).toEqual([]);
  });

  it("prefers the quote amount", () => {
    expect(escrowAmountFromBid({ amount: "900.00", quoteAmount: "1200.50" })).toEqual({ amount: 1200.5, source: "quote" });
    expect(escrowAmountFromBid({ amount: 900, quoteAmount: null })).toEqual({ amount: 900, source: "bid" });
  });

  it("derives payment status from milestones", () => {
    const m = (...s: MilestoneStatus[]) => s.map((status) => ({ status }));
    const { HELD, PENDING, RELEASED, REFUNDED } = MilestoneStatus;
    expect(paymentStatusFor(m(HELD, PENDING, PENDING), PaymentStatus.PENDING)).toBe(PaymentStatus.HELD);
    expect(paymentStatusFor(m(RELEASED, HELD, PENDING), PaymentStatus.HELD)).toBe(PaymentStatus.PARTIALLY_RELEASED);
    expect(paymentStatusFor(m(RELEASED, RELEASED, RELEASED), PaymentStatus.HELD)).toBe(PaymentStatus.RELEASED);
    expect(paymentStatusFor(m(REFUNDED, REFUNDED, REFUNDED), PaymentStatus.HELD)).toBe(PaymentStatus.REFUNDED);
    expect(paymentStatusFor(m(RELEASED, REFUNDED, REFUNDED), PaymentStatus.HELD)).toBe(PaymentStatus.PARTIALLY_RELEASED);
    expect(paymentStatusFor([], PaymentStatus.PENDING)).toBe(PaymentStatus.PENDING);
  });
});

describe("category matching (M-13)", () => {
  it("matches whole words only", () => {
    expect(textMatchesCategory("AC repair and servicing", "appliance")).toBe(true);
    expect(textMatchesCategory("Facility contractor, tracking", "appliance")).toBe(false);
    expect(textMatchesCategory("in painting", "office_facilities")).toBe(false);
    expect(textMatchesCategory("Office facilities management", "office_facilities")).toBe(true);
    expect(matchingKeywords("cleaning", "Deep-cleaning and housekeeping")).toEqual(expect.arrayContaining(["deep cleaning", "housekeeping"]));
    expect(matchingKeywords("plumbing", null)).toEqual([]);
  });

  it("matches shortlist tags in both directions", () => {
    expect(tagMatchesCategory("kitchen", "plumbing")).toBe(true);
    expect(tagMatchesCategory("fast-plumber", "plumbing")).toBe(true);
    expect(tagMatchesCategory("in", "painting")).toBe(false);
    expect(tagMatchesCategory("reliable", "plumbing")).toBe(false);
  });

  it("scores strong matches higher than weak ones", () => {
    const strong = skillOverlapScore("plumbing", "Plumber, pipes", 35);
    const weak = skillOverlapScore("plumbing", "bathroom", 35);
    const none = skillOverlapScore("plumbing", "Carpentry", 35);
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(none).toEqual({ score: 0, hits: [] });
  });
});

describe("analytics helpers (L-6)", () => {
  it("computes medians correctly for even counts", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([])).toBeNull();
  });
  it("caps rates at 100 and handles zero", () => {
    expect(rate(3, 2)).toBe(100);
    expect(rate(1, 3)).toBe(33.3);
    expect(rate(1, 0)).toBe(0);
    expect(mean([1, 2])).toBe(1.5);
  });
});

describe("time zones (M-8)", () => {
  it("gives the same 7-day strip regardless of server time zone", () => {
    // 23:30 IST on a Sunday = 18:00 UTC.
    const now = new Date("2026-09-20T18:00:00Z");
    const ist = localDatesAhead(7, "Asia/Kolkata", now);
    expect(ist[0]).toEqual({ date: "2026-09-20", dayKey: "sun" });
    expect(ist.map((d) => d.dayKey)).toEqual(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);
    const utcNextDay = localDatesAhead(1, "Asia/Kolkata", new Date("2026-09-20T18:45:00Z"));
    expect(utcNextDay[0].date).toBe("2026-09-21");
    expect(monthKeyInZone(new Date("2026-09-30T20:00:00Z"), "Asia/Kolkata")).toBe("2026-10");
    expect(localDatesAhead(2, "Not/AZone", now)).toHaveLength(2);
  });

  it("builds availability heat in the pro's zone", () => {
    const now = new Date("2026-09-20T18:00:00Z");
    const heat = buildAvailabilityHeat({ sun: { enabled: true, start: "09:00", end: "17:00" } }, ["2026-09-27"], "Asia/Kolkata", now);
    expect(heat.days[0]).toMatchObject({ key: "sun", hours: 8, blocked: false });
    expect(heat.clean).toBe(true);
    expect(heat.totalHours).toBe(8);
  });

  it("does not block invites for pros without a schedule", () => {
    expect(shortlistInviteBlockedByHeat(buildAvailabilityHeat(null, [])).blocked).toBe(false);
    expect(shortlistInviteBlockedByHeat(buildAvailabilityHeat({ mon: { enabled: true, start: "09:00", end: "10:00" } }, [])).blocked).toBe(true);
  });
});

describe("geo", () => {
  it("never treats missing coordinates as 0,0", () => {
    expect(haversineKm(12.9, 77.6, null, null)).toBeNull();
    expect(haversineKm(12.9, 77.6, undefined, 77.6)).toBeNull();
    expect(haversineKm(12.9, 77.6, 12.9, 77.6)).toBe(0);
    expect(parseCoordPair(null, null)).toBeNull();
    expect(parseCoordPair("", "")).toBeNull();
    expect(parseCoordPair("12.5", "77")).toEqual({ lat: 12.5, lng: 77 });
  });
});

describe("file sniffing (C-4)", () => {
  it("recognizes only real image/PDF signatures", () => {
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
    expect(sniff(Buffer.from("RIFF1234WEBPVP8 "))?.mime).toBe("image/webp");
    expect(sniff(Buffer.from("%PDF-1.7"))?.mime).toBe("application/pdf");
    expect(sniff(Buffer.from("<html><script>"))).toBeNull();
    expect(sniff(Buffer.from("<svg xmlns"))).toBeNull();
    expect(sniff(Buffer.from("GIF89a"))).toBeNull();
    expect(sniff(Buffer.alloc(0))).toBeNull();
  });
});

describe("configuration (M-9)", () => {
  const base = { JWT_SECRET: "short", FILE_URL_SECRET: "x".repeat(40) };
  it("refuses weak secrets in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...base, NODE_ENV: "production", JWT_SECRET: "change-me-in-production" })).toThrow();
    expect(() => loadConfig({ NODE_ENV: "production", JWT_SECRET: "y".repeat(40) })).toThrow(/FILE_URL_SECRET/);
    expect(loadConfig({ ...base, NODE_ENV: "production", JWT_SECRET: "y".repeat(40) }).isProd).toBe(true);
  });
  it("requires a secret at all", () => {
    expect(() => loadConfig({ NODE_ENV: "development" })).toThrow(/JWT_SECRET/);
    expect(loadConfig({ NODE_ENV: "development", JWT_SECRET: "dev" }).corsOrigins.length).toBeGreaterThan(0);
  });
});
