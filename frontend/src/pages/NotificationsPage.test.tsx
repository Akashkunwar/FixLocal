import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../components/Toast";
import { json, mockFetch } from "../test/http";

vi.mock("../components/Shell", async () => ({ Shell: (await import("../test/pageMocks")).FakeShell }));
const { NotificationsPage } = await import("./NotificationsPage");

const note = (id: string, title: string) => ({ id, type: "message", title, body: "", read: false, createdAt: "2026-10-27T09:00:00Z" });

describe("NotificationsPage filters (fe-logic MED 15)", () => {
  it("drops a slow answer for the previous filter", async () => {
    let releaseAll: (r: Response) => void = () => undefined;
    mockFetch((url) => {
      if (url.includes("types=message")) return json(200, { notifications: [note("n2", "Only messages")], unreadCount: 1, total: 1 });
      if (url.startsWith("/api/notifications?")) return new Promise<Response>((r) => (releaseAll = r));
      return undefined;
    });
    render(
      <MemoryRouter>
        <ToastProvider>
          <NotificationsPage />
        </ToastProvider>
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole("button", { name: "Messages" }));
    expect(await screen.findByText("Only messages")).toBeInTheDocument();
    releaseAll(json(200, { notifications: [note("n1", "From the All filter")], unreadCount: 5, total: 9 }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("From the All filter")).toBeNull();
  });
});
