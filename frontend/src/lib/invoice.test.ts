import { afterEach, describe, expect, it, vi } from "vitest";
import { printMilestoneInvoice } from "./invoice";
import type { Job, JobPayments } from "../api/jobs";

const job = { id: "12345678-aaaa", title: "Fix <script>alert(1)</script> tap", status: "completed" } as unknown as Job;
const payments = { milestones: [], escrowAmount: 1000, totalReleased: 0 } as unknown as JobPayments;

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
afterEach(() => {
  vi.useRealTimers();
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

describe("printMilestoneInvoice (L-1)", () => {
  it("prints in a new window with the opener link cut, without downloading", () => {
    vi.useFakeTimers();
    const doc = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
    const win = { opener: window as unknown, document: doc, focus: vi.fn(), print: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
    const createUrl = vi.fn();
    URL.createObjectURL = createUrl;

    expect(printMilestoneInvoice(job, payments)).toBe("printed");
    expect(open.mock.calls[0][2]).not.toContain("noopener");
    expect(win.opener).toBeNull();
    const html = doc.write.mock.calls[0][0] as string;
    expect(html).not.toContain("<script>alert(1)</script>");
    vi.runAllTimers();
    expect(win.print).toHaveBeenCalled();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it("downloads when pop-ups are blocked, revoking the URL later", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "open").mockReturnValue(null);
    const revoke = vi.fn();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = revoke;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    expect(printMilestoneInvoice(job, payments)).toBe("downloaded");
    expect(click).toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });
});
