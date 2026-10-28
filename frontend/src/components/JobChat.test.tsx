import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ApiError } from "../api/client";
import { ToastProvider } from "./Toast";

const listMessages = vi.fn();
const close = vi.fn();

vi.mock("../api/extras", async (orig) => ({
  ...(await orig<typeof import("../api/extras")>()),
  listMessages: (...args: unknown[]) => listMessages(...args),
  markThreadRead: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../lib/sse", () => ({ openSse: vi.fn(() => ({ close, supported: true })) }));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "client-1", email: "c@x.test", role: "HOMEOWNER" } }),
}));

const { JobChat } = await import("./JobChat");

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  listMessages.mockReset();
  close.mockReset();
});
afterEach(() => vi.useRealTimers());

const renderChat = () =>
  render(
    <ToastProvider>
      <JobChat jobId="job-1" proId="pro-1" />
    </ToastProvider>
  );

describe("JobChat polling (L-2)", () => {
  it("stops polling and closes the stream once access is refused", async () => {
    listMessages.mockRejectedValue(new ApiError("Forbidden", 403, "FORBIDDEN"));
    renderChat();
    await flush();
    await flush(5 * 60_000);
    expect(listMessages).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("backs off from 3s towards 60s while requests fail, and resets after a success", async () => {
    listMessages.mockRejectedValue(new ApiError("Server error", 500));
    renderChat();
    await flush();
    expect(listMessages).toHaveBeenCalledTimes(1);
    await flush(5_900);
    expect(listMessages).toHaveBeenCalledTimes(1);
    await flush(100); // 6s after the first failure
    expect(listMessages).toHaveBeenCalledTimes(2);
    await flush(12_000); // then 12s
    expect(listMessages).toHaveBeenCalledTimes(3);
    await flush(10 * 60_000);
    const callsInTenMinutes = listMessages.mock.calls.length;
    expect(callsInTenMinutes).toBeLessThan(16); // capped at one call a minute, not every 3s

    listMessages.mockResolvedValue({ messages: [], canSend: true });
    await flush(60_000);
    const afterSuccess = listMessages.mock.calls.length;
    await flush(3_000);
    expect(listMessages.mock.calls.length).toBe(afterSuccess + 1);
  });
});

describe("JobChat switching threads (fe-logic MED 13)", () => {
  it("never shows the previous thread's messages after switching", async () => {
    let releaseOld: (v: unknown) => void = () => undefined;
    const msg = (id: string, body: string) => ({ id, body, createdAt: "2026-10-27T10:00:00Z", sender: { id: "p", name: "Pro", role: "TRADESPERSON" }, attachments: [] });
    listMessages.mockImplementation((_job: string, pro: string) =>
      pro === "pro-old"
        ? new Promise((r) => (releaseOld = r))
        : Promise.resolve({ messages: [msg("m2", "new thread hello")], canSend: true, hasMore: false, nextBefore: null })
    );
    const { rerender } = render(
      <ToastProvider>
        <JobChat jobId="job-1" proId="pro-old" />
      </ToastProvider>
    );
    rerender(
      <ToastProvider>
        <JobChat jobId="job-1" proId="pro-new" />
      </ToastProvider>
    );
    await flush();
    releaseOld({ messages: [msg("m1", "old thread secret")], canSend: true, hasMore: false, nextBefore: null });
    await flush();
    expect(screen.getByText("new thread hello")).toBeInTheDocument();
    expect(screen.queryByText("old thread secret")).toBeNull();
  });
});
