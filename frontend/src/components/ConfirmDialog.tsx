import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog } from "./ui/Dialog";
import { t } from "../lib/i18n";

export type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
};

export type PromptOptions = ConfirmOptions & {
  label: string;
  defaultValue?: string;
  placeholder?: string;
  /** Multi-line answer. */
  multiline?: boolean;
  /** Confirm stays disabled while the answer is empty. */
  required?: boolean;
  maxLength?: number;
};

type Request =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void };

type Ctx = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
};

const ConfirmContext = createContext<Ctx | null>(null);

/**
 * In-app replacement for window.confirm / window.prompt: translated, styled, keyboard and
 * screen-reader friendly (ux HIGH 2). `await confirm({...})` resolves true/false;
 * `await prompt({...})` resolves the text or null when cancelled.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<Request | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setReq({ kind: "confirm", opts, resolve })),
    []
  );
  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setValue(opts.defaultValue ?? "");
        setReq({ kind: "prompt", opts, resolve });
      }),
    []
  );

  function finish(ok: boolean) {
    if (!req) return;
    if (req.kind === "confirm") req.resolve(ok);
    else req.resolve(ok ? value : null);
    setReq(null);
  }

  const ctx = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);
  const opts = req?.opts;
  const isPrompt = req?.kind === "prompt";
  const p = isPrompt ? (opts as PromptOptions) : null;
  const blocked = !!p?.required && !value.trim();

  return (
    <ConfirmContext.Provider value={ctx}>
      {children}
      <Dialog
        open={!!req}
        onClose={() => finish(false)}
        role="alertdialog"
        title={opts?.title ?? ""}
        description={opts?.message}
        closeLabel={opts?.cancelLabel || t("Cancel")}
        initialFocusRef={isPrompt ? inputRef : undefined}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => finish(false)}>
              {opts?.cancelLabel || t("Cancel")}
            </button>
            <button
              type="submit"
              form="confirm-dialog-form"
              className={opts?.danger ? "btn-danger" : "btn-primary"}
              disabled={blocked}
            >
              {opts?.confirmLabel || t("OK")}
            </button>
          </>
        }
      >
        <form
          id="confirm-dialog-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!blocked) finish(true);
          }}
        >
          {p && (
            <>
              <label className="label" htmlFor="confirm-dialog-input">
                {p.label}
              </label>
              {p.multiline ? (
                <textarea
                  ref={inputRef}
                  id="confirm-dialog-input"
                  className="input min-h-24"
                  value={value}
                  placeholder={p.placeholder}
                  maxLength={p.maxLength}
                  onChange={(e) => setValue(e.target.value)}
                />
              ) : (
                <input
                  ref={inputRef}
                  id="confirm-dialog-input"
                  className="input"
                  value={value}
                  placeholder={p.placeholder}
                  maxLength={p.maxLength}
                  onChange={(e) => setValue(e.target.value)}
                />
              )}
            </>
          )}
        </form>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Ctx {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm outside ConfirmProvider");
  return ctx;
}
