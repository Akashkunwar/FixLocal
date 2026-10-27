import { Star } from "lucide-react";
import { useI18n } from "../../lib/i18n";

/** Small filled star after a rating number; screen readers hear "out of 5" instead. */
export function RatingStar({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  return (
    <>
      <Star className={`inline-block h-3 w-3 shrink-0 fill-amber-400 align-[-0.1em] text-amber-500 ${className}`} strokeWidth={1.75} aria-hidden />
      <span className="sr-only"> {t("out of 5")}</span>
    </>
  );
}
