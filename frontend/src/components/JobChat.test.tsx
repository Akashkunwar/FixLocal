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
