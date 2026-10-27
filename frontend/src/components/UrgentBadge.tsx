import { Zap } from "lucide-react";
import { useI18n } from "../lib/i18n";

/** "Urgent" pill for jobs posted as needed within 24 hours. */
export function UrgentBadge({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-300 ${className}`}
      data-testid="urgent-badge"
    >
      <Zap className="h-3 w-3" aria-hidden /> {t("Urgent")}
    </span>
  );
}
