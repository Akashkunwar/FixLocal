import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// A plain function (not vi.fn) so a rejected response isn't reported as a test failure by the spy.
let respond: () => Promise<unknown> = async () => ({ pending: [] });
let calls = 0;
vi.mock("../api/extras", async (orig) => ({
  ...(await orig<typeof import("../api/extras")>()),
  listPendingReviews: () => {
    calls += 1;
    return respond();
  },
}));

const { PendingReviewsCard } = await import("./PendingReviewsCard");

const item = (n: number) => ({
  jobId: `job-${n}`,
  title: `Fix tap ${n}`,
  completedAt: null,
  counterpartId: `pro-${n}`,
  counterpartName: `Ravi ${n}`,
  link: `/client/jobs/job-${n}#review`,
});

const renderCard = () =>
  render(
    <MemoryRouter>
      <PendingReviewsCard />
    </MemoryRouter>,
  );

beforeEach(() => {
  calls = 0;
});

describe("PendingReviewsCard", () => {
  it("renders nothing when every finished job is reviewed", async () => {
    respond = async () => ({ pending: [] });
    const { container } = renderCard();
    await vi.waitFor(() => expect(calls).toBe(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing if the request fails", async () => {
    respond = async () => {
      throw new Error("offline");
    };
    const { container } = renderCard();
    await act(async () => {});
    expect(calls).toBe(1);
    expect(container).toBeEmptyDOMElement();
  });

  it("prompts for the latest job and links straight to its review form", async () => {
    respond = async () => ({ pending: [item(1), item(2)] });
    renderCard();
    expect(await screen.findByRole("heading", { name: "2 finished jobs are waiting for your review" })).toBeVisible();
    expect(screen.getByText(/Rate Ravi 1 for “Fix tap 1”/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Leave a review" })).toHaveAttribute("href", "/client/jobs/job-1#review");
    expect(screen.getByRole("link", { name: "Fix tap 2" })).toHaveAttribute("href", "/client/jobs/job-2#review");
  });
});
