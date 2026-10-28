import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { json, mockFetch } from "../test/http";

type Handlers = { onOpen?: () => void; onEvent?: (e: string, d: unknown) => void };
let handlers: Handlers = {};
vi.mock("../lib/sse", () => ({
  openSse: (_path: string, h: Handlers) => {
    handlers = h;
    return { close: () => undefined, supported: true };
  },
}));
const { NotificationBell } = await import("./NotificationBell");

const n = (id: string) => ({ id, type: "message", title: "New message", body: "", read: false, createdAt: "2026-10-27T09:00:00Z" });

describe("NotificationBell", () => {
  it("counts a repeated live event once and reloads on reconnect (fe-logic LOW 19)", async () => {
    const { calls } = mockFetch(() => json(200, { notifications: [], unreadCount: 0 }));
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    );
    await act(async () => undefined);
    act(() => {
      handlers.onEvent?.("notification", { notification: n("a") });
      handlers.onEvent?.("notification", { notification: n("a") });
    });
    expect(screen.getByText("1")).toBeInTheDocument();
    const before = calls.length;
    await act(async () => handlers.onOpen?.());
    expect(calls.length).toBeGreaterThan(before);
  });

  it("closes on Escape and returns focus to the bell; no 'live/polling' jargon (ux MED 8)", async () => {
    mockFetch(() => json(200, { notifications: [n("a")], unreadCount: 1 }));
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    );
    const bell = screen.getByRole("button", { name: /Notifications/ });
    await userEvent.click(bell);
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    expect(panel).not.toHaveTextContent(/polling|live/);
    expect(bell).not.toHaveAttribute("title", expect.stringMatching(/SSE|polling/));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bell).toHaveFocus();
  });
});
