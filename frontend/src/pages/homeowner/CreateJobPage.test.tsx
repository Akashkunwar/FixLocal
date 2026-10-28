import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/Toast";
import { json, mockFetch } from "../../test/http";
import { JOB_DRAFT_KEY } from "../../lib/repeatJob";
import { parseCoord } from "../../lib/geo";

vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "c1", role: "HOMEOWNER" } }) }));
vi.mock("../../components/Shell", async () => ({ Shell: (await import("../../test/pageMocks")).FakeShell }));
vi.mock("../../components/LazyMapPinPicker", () => ({
  LazyMapPinPicker: ({ lat, lng }: { lat: number | null; lng: number | null }) => (
    <p data-testid="map">
      map {String(lat)} {String(lng)}
    </p>
  ),
  preloadMapPicker: () => undefined,
}));

const { CreateJobPage, localInputToIso, sanitizeDraft } = await import("./CreateJobPage");

const draft = {
  title: "Fix the kitchen sink",
  description: "Leaking under the sink since Monday",
  leadGroup: "Home repair & maintenance",
  category: "plumbing",
  siteType: "residential",
  cadence: "one_time",
  cadenceNote: "",
  maxBids: "5",
  budgetMin: "500",
  budgetMax: "2000",
  address: "",
  city: "Bengaluru",
  area: "",
  pincode: "",
  preferredStart: "",
  urgent: "",
  lat: "12.97",
  lng: "77.59",
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <CreateJobPage />
      </ToastProvider>
    </MemoryRouter>
  );

afterEach(() => vi.useRealTimers());

describe("job wizard", () => {
  it("a double-click on Continue on step 2 never posts the job (fe-logic HIGH 2)", async () => {
    localStorage.setItem(JOB_DRAFT_KEY, JSON.stringify(draft));
    const { calls } = mockFetch(() => json(201, { job: { id: "j1" } }));
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.dblClick(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("button", { name: "Post job" })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    // Once armed, an intentional click posts.
    await waitFor(() => expect(screen.getByRole("button", { name: "Post job" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Post job" }));
    await waitFor(() => expect(calls).toHaveLength(1));
  });

  it("a mangled coordinate in a saved draft can't crash the map (fe-logic HIGH 3)", () => {
    localStorage.setItem(JOB_DRAFT_KEY, JSON.stringify({ ...draft, lat: "12,97,1", lng: "abc" }));
    expect(sanitizeDraft({ ...draft, lat: "NaN", lng: "77" } as never).lat).toBe("12.9716");
    expect(parseCoord("12,97", "lat")).toBe(12.97);
    expect(parseCoord("95", "lat")).toBeNull();
    expect(parseCoord("1e3", "lng")).toBeNull();
  });

  it("typing a bad latitude blocks Continue with a reason instead of crashing (fe-logic HIGH 3, ux LOW 14)", async () => {
    localStorage.setItem(JOB_DRAFT_KEY, JSON.stringify(draft));
    mockFetch(() => undefined);
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    const lat = screen.getByLabelText("Latitude");
    await userEvent.clear(lat);
    await userEvent.type(lat, "12,9,7");
    expect(screen.getByTestId("map")).toHaveTextContent("map null null");
    expect(screen.getByText(/Enter a valid latitude/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveAttribute("aria-disabled", "true");
  });

  it("explains why Continue is not ready on step 1 (ux LOW 14)", async () => {
    mockFetch(() => undefined);
    localStorage.setItem(JOB_DRAFT_KEY, JSON.stringify({ ...draft, title: "", description: "" }));
    renderPage();
    expect(screen.getByText(/Add a title/)).toBeInTheDocument();
    expect(screen.getByText(/Describe the work/)).toBeInTheDocument();
  });

  it("sends the preferred start as an instant, not naive local time (fe-logic HIGH 4)", async () => {
    expect(localInputToIso("2026-11-02T09:30")).toBe(new Date(2026, 10, 2, 9, 30).toISOString());
    localStorage.setItem(JOB_DRAFT_KEY, JSON.stringify({ ...draft, preferredStart: "2026-11-02T09:30" }));
    const { calls } = mockFetch(() => json(201, { job: { id: "j1" } }));
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Post job" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Post job" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    const body = calls[0].init.body as FormData;
    expect(body.get("preferredStart")).toBe(new Date(2026, 10, 2, 9, 30).toISOString());
  });

  it("allows up to 50 bids like the server (fe-logic LOW 20)", () => {
    mockFetch(() => undefined);
    renderPage();
    expect(screen.getByLabelText("Max bids")).toHaveAttribute("max", "50");
  });
});
