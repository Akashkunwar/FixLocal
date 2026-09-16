import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";
import clsx from "clsx";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; message: string };

type ToastCtx = {
  toast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
};

const Ctx = createContext<ToastCtx | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = ++seq;
      setItems((xs) => [...xs, { id, kind, message }]);
      window.setTimeout(() => dismiss(id), 4200);
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      toast,
      success: (m: string) => toast(m, "success"),
      error: (m: string) => toast(m, "error"),
    }),
    [toast]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-viewport" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lift text-sm bg-white",
              t.kind === "success" && "border-emerald-200",
              t.kind === "error" && "border-rose-200",
              t.kind === "info" && "border-slate-200"
            )}
            role="status"
          >
            {t.kind === "success" ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
            ) : t.kind === "error" ? (
              <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
            ) : null}
            <p className="flex-1 text-slate-800">{t.message}</p>
            <button
              type="button"
              className="text-slate-400 hover:text-slate-600"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast outside provider");
  return ctx;
}
