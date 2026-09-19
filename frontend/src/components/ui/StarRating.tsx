import { Star } from "lucide-react";
import clsx from "clsx";

export function StarRating({
  value,
  onChange,
  size = 18,
  readonly = false,
}: {
  value: number;
  onChange?: (n: number) => void;
  size?: number;
  readonly?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-0.5" role={readonly ? "img" : "radiogroup"} aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readonly}
          className={clsx(!readonly && "hover:scale-110 transition", readonly && "cursor-default")}
          onClick={() => onChange?.(n)}
          role={readonly ? undefined : "radio"}
          aria-checked={readonly ? undefined : n === value}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
        >
          <Star
            style={{ width: size, height: size }}
            className={clsx(
              n <= value ? "fill-amber-400 text-amber-400" : "text-slate-300"
            )}
          />
        </button>
      ))}
    </div>
  );
}
