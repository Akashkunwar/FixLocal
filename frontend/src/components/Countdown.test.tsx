import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Countdown, formatCountdown } from "./Countdown";
import { InviteHistoryList } from "../pages/homeowner/job/InviteHistoryList";
import type { JobInvite } from "../api/jobs";

afterEach(() => vi.useRealTimers());

describe("Countdown (L-3)", () => {
  it("formats minutes and hours", () => {
    expect(formatCountdown(65_000)).toBe("1:05");
    expect(formatCountdown(2 * 3600_000 + 5 * 60_000)).toBe("2h 5m");
    expect(formatCountdown(-5)).toBe("0:00");
  });

  it("ticks on its own and stops at zero", () => {
    vi.useFakeTimers();
    const until = Date.now() + 3_000;
    render(<Countdown until={until} />);
    expect(screen.getByText("0:03")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText("0:02")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText("0:00")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("InviteHistoryList", () => {
  it("shows the quota as used/limit and a live re-invite countdown", () => {
    vi.useFakeTimers();
    const invite = {
      id: "i1",
      tradespersonId: "p1",
      tradespersonName: "Arjun",
      status: "declined",
      invitedAt: new Date().toISOString(),
      declinedAt: new Date().toISOString(),
      declineReason: "schedule",
      inCooldown: true,
      cooldownUntil: new Date(Date.now() + 90_000).toISOString(),
    } as unknown as JobInvite;
    render(
      <MemoryRouter>
        <InviteHistoryList invites={[invite]} quota={{ used: 1, limit: 3, remaining: 2 }} now={Date.now()} />
      </MemoryRouter>
    );
    expect(screen.getByText(/1\/3 used/)).toBeInTheDocument();
    expect(screen.queryByText(/inviteQuota/)).toBeNull();
    expect(screen.getByText("Schedule conflict")).toBeInTheDocument();
    expect(screen.getByText("1:30")).toBeInTheDocument();
  });
});
