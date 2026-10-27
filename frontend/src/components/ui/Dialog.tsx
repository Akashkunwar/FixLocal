import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import clsx from "clsx";
import { t } from "../../lib/i18n";

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("inert") && el.getAttribute("aria-hidden") !== "true"
  );
}

/**
 * Focus management shared by every dialog, drawer and popover panel: moves focus in on open,
 * keeps Tab inside (when `trap`), closes on Escape, and puts focus back where it was on close.
 */
export function useDialogFocus(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  opts: { trap?: boolean; initialFocusRef?: RefObject<HTMLElement | null> } = {}
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const { trap = true, initialFocusRef } = opts;
  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = initialFocusRef?.current ?? (panel ? focusables(panel)[0] : null) ?? panel;
    first?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !trap || !panelRef.current) return;
      const items = focusables(panelRef.current);
      if (!items.length) {
        e.preventDefault();
        panelRef.current.focus();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === firstEl || !panelRef.current.contains(active))) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && (active === lastEl || !panelRef.current.contains(active))) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (returnTo && document.contains(returnTo)) returnTo.focus();
    };
  }, [open, panelRef, trap, initialFocusRef]);
}

type DialogProps = {
  open: boolean;
  onClose: () => void;
  /** Accessible name, shown as the heading. */
  title: ReactNode;
  /** Small line above the title (e.g. "Match explainability"). */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** `drawer` slides in from the right (full height); `modal` is a centred box. */
  variant?: "drawer" | "modal";
  children?: ReactNode;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Label for the close button and backdrop. */
  closeLabel?: string;
  /** `alertdialog` for confirmations. */
  role?: "dialog" | "alertdialog";
  className?: string;
};

/** Accessible dialog / drawer: named, modal, focus-trapped, closes on Escape, restores focus. */
export function Dialog({
  open,
  onClose,
  title,
  eyebrow,
  description,
  variant = "modal",
  children,
  footer,
  initialFocusRef,
  closeLabel,
  role = "dialog",
  className,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useDialogFocus(open, panelRef, onClose, { initialFocusRef });

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  const close = closeLabel || t("Close");
  const drawer = variant === "drawer";
  return createPortal(
    <div className={clsx("fixed inset-0 z-50 flex", drawer ? "justify-end" : "items-center justify-center p-4")}>
      <div className="absolute inset-0 bg-slate-900/40" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={clsx(
          "relative z-10 flex flex-col bg-white shadow-xl outline-none",
          drawer ? "h-full w-full max-w-md" : "max-h-[90vh] w-full max-w-md rounded-2xl",
          className
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            {eyebrow && <p className="text-xs uppercase tracking-wide text-slate-500">{eyebrow}</p>}
            <h2 id={titleId} className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            {description && (
              <div id={descId} className="mt-1 text-sm text-slate-600">
                {description}
              </div>
            )}
          </div>
          <button type="button" className="btn-ghost btn-sm touch-target shrink-0" onClick={onClose} aria-label={close}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {children !== undefined && <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>}
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-4 py-3 sm:px-5">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
