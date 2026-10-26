import { describe, expect, it } from "vitest";
import { NOTIFICATION_GROUPS, dayLabel, notificationHref } from "./notifications";
import { NOTIF_PREF_META } from "./notifPrefs";

describe("notification centre helpers", () => {
  it("labels days relative to now", () => {
    const now = new Date(2026, 9, 26, 20, 0);
    expect(dayLabel(new Date(2026, 9, 26, 1, 0).toISOString(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 9, 25, 23, 0).toISOString(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 20, 9, 0).toISOString(), now)).toMatch(/20 Oct/);
    expect(dayLabel(new Date(2025, 0, 2).toISOString(), now)).toMatch(/2025/);
  });

  it("every notification type a user can switch off is reachable from a filter", () => {
    const grouped = new Set(NOTIFICATION_GROUPS.flatMap((g) => g.types));
    for (const p of NOTIF_PREF_META) expect(grouped.has(p.key), p.key).toBe(true);
  });

  it("deep-links invites to the bid form and falls back to the stored link", () => {
    const base = { id: "1", type: "match", title: "t", body: "b", read: false, createdAt: "" };
    expect(notificationHref({ ...base, meta: { invite: true, jobId: "j1" } })).toBe("/professional/jobs/j1?invite=1#bid-form");
    expect(notificationHref({ ...base, link: "/client/jobs/j2" })).toBe("/client/jobs/j2");
    expect(notificationHref(base)).toBe("#");
  });
});
