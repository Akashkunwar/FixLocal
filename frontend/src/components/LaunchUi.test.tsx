import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "./Toast";
import { json, mockFetch } from "../test/http";

const auth = {
  user: { id: "me", email: "me@x.test", role: "HOMEOWNER", emailVerified: true, emailNotifications: true } as Record<string, unknown>,
  updateProfile: vi.fn(async () => {}),
  refreshUser: vi.fn(async () => {}),
};
vi.mock("../auth/AuthContext", () => ({ useAuth: () => auth }));

const { CancelBookingButton, CancellationNote } = await import("./CancelBookingButton");
const { BlockButton } = await import("./BlockButton");
const { PrivacySettings } = await import("./PrivacySettings");
const { TermsBanner } = await import("./TermsBanner");

const wrap = (ui: React.ReactNode) =>
  render(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>,
  );

afterEach(() => {
  vi.unstubAllGlobals();
  auth.user = { id: "me", email: "me@x.test", role: "HOMEOWNER", emailVerified: true, emailNotifications: true };
});

describe("CancelBookingButton", () => {
  it("asks for confirmation, sends the reason and reports the refund", async () => {
    const { calls } = mockFetch((url, init) =>
      url.endsWith("/api/jobs/j1/cancel-booking") && init.method === "POST" ? json(200, { job: {}, refunded: 700 }) : undefined,
    );
    const onDone = vi.fn();
    wrap(<CancelBookingButton jobId="j1" side="client" onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel booking" }));
    expect(calls).toHaveLength(0);
    await userEvent.type(screen.getByLabelText(/Reason/), "Plans changed");
    await userEvent.click(screen.getByRole("button", { name: "Yes, cancel booking" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ reason: "Plans changed" });
    expect(await screen.findByText(/₹700 held in escrow was refunded/)).toBeVisible();
  });

  it("can be backed out of without a request", async () => {
    const { calls } = mockFetch(() => undefined);
    wrap(<CancelBookingButton jobId="j1" side="professional" onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel booking" }));
    expect(screen.getByText(/goes back to the client/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Keep booking" }));
    expect(screen.getByRole("button", { name: "Cancel booking" })).toBeVisible();
    expect(calls).toHaveLength(0);
  });

  it("explains who cancelled", () => {
    wrap(<CancellationNote cancelledBy="professional" reason="Can't make the date" />);
    expect(screen.getByTestId("cancellation-note")).toHaveTextContent(/cancelled by the professional.*Can't make the date/);
  });
});

describe("BlockButton", () => {
  it("is hidden for yourself", () => {
    wrap(<BlockButton userId="me" name="Me" />);
    expect(screen.queryByRole("button", { name: "Block" })).toBeNull();
  });

  it("blocks after confirmation", async () => {
    const { calls } = mockFetch((url, init) =>
      url.endsWith("/api/blocks") && init.method === "POST" ? json(201, { blocked: true }) : undefined,
    );
    wrap(<BlockButton userId="pro-1" name="Ravi" />);
    await userEvent.click(screen.getByRole("button", { name: "Block" }));
    expect(screen.getByText(/Block Ravi\?/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Block" }));
    expect(await screen.findByText(/Blocked · manage in Settings/)).toBeVisible();
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ userId: "pro-1" });
  });
});

describe("PrivacySettings", () => {
  it("lists blocked people and unblocks them", async () => {
    mockFetch((url, init) => {
      if (url.endsWith("/api/blocks") && !init.method) {
        return json(200, { blocks: [{ userId: "p2", name: "Sunil", role: "TRADESPERSON", createdAt: "2026-10-25T00:00:00Z" }] });
      }
      if (url.endsWith("/api/blocks/p2") && init.method === "DELETE") return json(200, { blocked: false });
      return undefined;
    });
    wrap(<PrivacySettings />);
    expect(await screen.findByText("Sunil")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /Unblock/ }));
    expect(await screen.findByTestId("no-blocks")).toBeVisible();
  });

  it("turns email updates off", async () => {
    mockFetch((url) => (url.endsWith("/api/blocks") ? json(200, { blocks: [] }) : undefined));
    wrap(<PrivacySettings />);
    const sw = screen.getByRole("switch", { name: "Email updates" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    await userEvent.click(sw);
    expect(auth.updateProfile).toHaveBeenCalledWith({ emailNotifications: false });
  });

  it("downloads the data export as a file", async () => {
    mockFetch((url) => {
      if (url.endsWith("/api/blocks")) return json(200, { blocks: [] });
      if (url.endsWith("/api/auth/me/export")) return json(200, { format: "fixlocal-export-v1" });
      return undefined;
    });
    const createObjectURL = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    wrap(<PrivacySettings />);
    await userEvent.click(screen.getByRole("button", { name: /Download my data/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(createObjectURL).toHaveBeenCalled();
    click.mockRestore();
  });
});

describe("TermsBanner", () => {
  it("shows only for accounts that haven't accepted, and records acceptance", async () => {
    auth.user = { ...auth.user, termsAccepted: false };
    const { calls } = mockFetch((url, init) =>
      url.endsWith("/api/auth/accept-terms") && init.method === "POST" ? json(200, { user: {} }) : undefined,
    );
    wrap(<TermsBanner />);
    await userEvent.click(screen.getByRole("button", { name: "I accept" }));
    await waitFor(() => expect(auth.refreshUser).toHaveBeenCalled());
    expect(calls).toHaveLength(1);
  });

  it("stays hidden once accepted", () => {
    auth.user = { ...auth.user, termsAccepted: true };
    wrap(<TermsBanner />);
    expect(screen.queryByRole("region", { name: "Updated terms" })).toBeNull();
  });
});
