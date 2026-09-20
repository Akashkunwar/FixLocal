import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TemplateEditor } from "./TemplateEditor";
import { ToastProvider } from "./Toast";
import { DEFAULT_INTRO_STARTERS } from "../lib/introTemplates";

function setup(onSave = vi.fn(async (_items: unknown[]) => undefined)) {
  render(
    <ToastProvider>
      <TemplateEditor
        title="Intro templates"
        description="d"
        noun="intro"
        idPrefix="intro"
        value={DEFAULT_INTRO_STARTERS}
        defaults={DEFAULT_INTRO_STARTERS}
        placeholder="Say hi"
        onSave={onSave}
      />
    </ToastProvider>
  );
  return onSave;
}

describe("TemplateEditor", () => {
  it("adds a template and saves the whole list to the account", async () => {
    const onSave = setup();
    await userEvent.type(screen.getByLabelText("Intro template label"), "Quick");
    await userEvent.type(screen.getByLabelText("Intro template body"), "On my way");
    await userEvent.click(screen.getByRole("button", { name: "Add template" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as unknown as { label: string; body: string }[];
    expect(saved[0]).toMatchObject({ label: "Quick", body: "On my way" });
    expect(saved).toHaveLength(DEFAULT_INTRO_STARTERS.length + 1);
    expect(await screen.findByText("On my way")).toBeInTheDocument();
  });

  it("keeps the list unchanged and reports the error when saving fails", async () => {
    setup(vi.fn(async (_items: unknown[]) => Promise.reject(new Error("Network down"))));
    const first = screen.getAllByRole("listitem")[0];
    await userEvent.click(within(first).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Network down")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(DEFAULT_INTRO_STARTERS.length);
  });
});
