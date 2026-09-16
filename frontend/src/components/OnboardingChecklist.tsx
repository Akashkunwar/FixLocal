import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, X } from "lucide-react";
import clsx from "clsx";

export type OnboardingItem = {
  id: string;
  label: string;
  done: boolean;
  to?: string;
};

type Variant = "client" | "pro";

const DISMISS_KEY: Record<Variant, string> = {
  client: "fixlocal:onboarding:client:dismissed",
  pro: "fixlocal:onboarding:pro:dismissed",
};

export function OnboardingChecklist({
  variant,
  items,
  title,
  subtitle,
}: {
  variant: Variant;
  items: OnboardingItem[];
  title: string;
  subtitle?: string;
}) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY[variant]) === "1");
    } catch {
      setDismissed(false);
    }
  }, [variant]);

  const progress = useMemo(() => {
    const done = items.filter((i) => i.done).length;
    return { done, total: items.length };
  }, [items]);

  if (dismissed || items.length === 0) return null;
  if (progress.done >= progress.total) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY[variant], "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }

  return (
    <section className="mb-5 card overflow-hidden ring-1 ring-brand-100">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-brand-50 to-white px-4 py-3 sm:px-5">
        <div>
          <h2 className="font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          <p className="mt-1 text-[11px] font-medium text-brand-800">
            {progress.done} of {progress.total} done
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost btn-sm shrink-0"
          onClick={dismiss}
          aria-label="Dismiss checklist"
          title="Dismiss — you can ignore this"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ul className="divide-y divide-slate-100">
        {items.map((item) => (
          <li key={item.id}>
            {item.to && !item.done ? (
              <Link
                to={item.to}
                className="flex items-center gap-3 px-4 py-2.5 text-sm no-underline text-inherit hover:bg-slate-50 sm:px-5"
              >
                <ItemIcon done={item.done} />
                <span className={clsx(item.done && "text-slate-400 line-through")}>{item.label}</span>
              </Link>
            ) : (
              <div className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                <ItemIcon done={item.done} />
                <span className={clsx(item.done && "text-slate-400 line-through")}>{item.label}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ItemIcon({ done }: { done: boolean }) {
  return done ? (
    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
  ) : (
    <Circle className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
  );
}
