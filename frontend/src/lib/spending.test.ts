import { describe, expect, it } from "vitest";
import { monthLabel, spendingCsv } from "./spending";

describe("spending export", () => {
  it("writes a CSV that spreadsheets open safely", () => {
    const csv = spendingCsv([
      {
        jobId: "1",
        title: 'Fix "kitchen", tap',
        category: "plumbing",
        status: "completed",
        createdAt: "2026-10-01T10:00:00.000Z",
        completedAt: "2026-10-03T10:00:00.000Z",
        agreedAmount: 1500,
        paid: 1500,
        refunded: 0,
        inEscrow: 0,
        pro: { id: "p", name: "=HYPERLINK(evil)" },
      },
    ]);
    const [head, row] = csv.trim().split("\r\n");
    expect(head).toMatch(/^Posted,Job,Category,Status,Professional/);
    expect(row).toContain('"Fix ""kitchen"", tap"');
    expect(row).toContain("'=HYPERLINK(evil)");
    expect(row).toContain("Plumbing");
    expect(row).toMatch(/,1500,1500,0,0,2026-10-03$/);
  });

  it("labels months", () => {
    expect(monthLabel("2026-10")).toBe("Oct 2026");
  });
});
