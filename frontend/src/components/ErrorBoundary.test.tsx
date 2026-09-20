import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom({ fail }: { fail: boolean }) {
  if (fail) throw new Error("kaboom");
  return <p>page content</p>;
}

// React reports caught render errors through window "error" events in development; keep test output readable.
const swallow = (e: ErrorEvent) => e.preventDefault();
beforeEach(() => window.addEventListener("error", swallow));
afterEach(() => window.removeEventListener("error", swallow));

describe("ErrorBoundary", () => {
  it("shows a recoverable message instead of a blank app", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ErrorBoundary resetKey="/a">
        <Boom fail />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong on this page");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("recovers when the route changes", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rerender } = render(
      <ErrorBoundary resetKey="/a">
        <Boom fail />
      </ErrorBoundary>
    );
    rerender(
      <ErrorBoundary resetKey="/b">
        <Boom fail={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText("page content")).toBeInTheDocument();
  });
});
