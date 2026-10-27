import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "./Toast";
import { SaveJobButton } from "./SaveJobButton";
import { json, mockFetch } from "../test/http";

describe("SaveJobButton (fe-logic HIGH 8)", () => {
  it("shows an already-saved job as saved and can unsave it", async () => {
    const { calls } = mockFetch((url, init) => {
      if (url === "/api/favorites?type=job") return json(200, { favorites: [{ id: "f1", targetType: "job", targetId: "j1" }] });
      if (url.startsWith("/api/favorites?targetType=job&targetId=j1") && init.method === "DELETE") return json(200, { ok: true });
      return undefined;
    });
    render(
      <ToastProvider>
        <SaveJobButton jobId="j1" />
      </ToastProvider>
    );
    const btn = await screen.findByRole("button", { name: "Remove from saved jobs" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(btn).toBeEnabled());
    await userEvent.click(btn);
    expect(await screen.findByRole("button", { name: "Save job" })).toHaveAttribute("aria-pressed", "false");
    expect(calls.some((c) => c.init.method === "DELETE")).toBe(true);
  });
});
