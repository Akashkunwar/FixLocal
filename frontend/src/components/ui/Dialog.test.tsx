import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Dialog } from "./Dialog";
import { ToastProvider } from "../Toast";
import { useConfirm } from "../ConfirmDialog";
import { MatchScorePanel } from "../MatchScorePanel";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open drawer</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Match details" variant="drawer">
        <button>first inside</button>
        <button>last inside</button>
      </Dialog>
    </>
  );
}

describe("Dialog (ux HIGH 4)", () => {
  it("is named, takes focus, traps Tab, closes on Escape and returns focus", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "open drawer" });
    await userEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Match details" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    // Tab cycles inside: close button → first → last → back to close.
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("MatchScorePanel uses it", async () => {
    const onClose = vi.fn();
    render(
      <MatchScorePanel
        open
        onClose={onClose}
        name="Arjun"
        score={72}
        breakdown={{ skills: 30, rating: 20, response: 12, distance: 10, total: 72 } as never}
      />
    );
    expect(screen.getByRole("dialog", { name: /Arjun/ })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

function Asker({ onAnswer }: { onAnswer: (v: unknown) => void }) {
  const { confirm, prompt } = useConfirm();
  return (
    <>
      <button onClick={async () => onAnswer(await confirm({ title: "Withdraw your bid?", confirmLabel: "Withdraw", danger: true }))}>
        ask
      </button>
      <button onClick={async () => onAnswer(await prompt({ title: "Reason", label: "Why?", required: true }))}>prompt</button>
    </>
  );
}

describe("in-app confirm and prompt (ux HIGH 2)", () => {
  it("confirm resolves true on the action and false on Escape", async () => {
    const onAnswer = vi.fn();
    render(
      <ToastProvider>
        <Asker onAnswer={onAnswer} />
      </ToastProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "ask" }));
    expect(screen.getByRole("alertdialog", { name: "Withdraw your bid?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(onAnswer).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "ask" }));
    await userEvent.keyboard("{Escape}");
    expect(onAnswer).toHaveBeenLastCalledWith(false);
  });

  it("prompt needs an answer when required and returns it", async () => {
    const onAnswer = vi.fn();
    render(
      <ToastProvider>
        <Asker onAnswer={onAnswer} />
      </ToastProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "prompt" }));
    expect(screen.getByRole("button", { name: "OK" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Why?"), "Too far{Enter}");
    expect(onAnswer).toHaveBeenLastCalledWith("Too far");
  });
});
