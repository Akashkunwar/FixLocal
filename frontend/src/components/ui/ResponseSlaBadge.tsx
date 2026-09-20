import clsx from "clsx";
import { Zap, Clock, Turtle } from "lucide-react";

export type ResponseSla = {
  tier: "lightning" | "fast" | "same_day" | "steady" | "slow" | "unknown" | string;
  label: string;
  hours?: number | null;
  source?: "invite_to_bid" | "job_to_bid" | "none" | string;
  sampleSize?: number;
  inviteAvgHours?: number | null;
  jobAvgHours?: number | null;
};

const TIER_CLASS: Record<string, string> = {
  lightning: "bg-violet-50 text-violet-800 ring-violet-200",
  fast: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  same_day: "bg-sky-50 text-sky-800 ring-sky-200",
  steady: "bg-amber-50 text-amber-900 ring-amber-200",
  slow: "bg-rose-50 text-rose-800 ring-rose-200",
  unknown: "bg-slate-50 text-slate-600 ring-slate-200",
};

function Icon({ tier }: { tier: string }) {
  if (tier === "lightning" || tier === "fast") return <Zap className="h-3 w-3" />;
  if (tier === "slow") return <Turtle className="h-3 w-3" />;
  return <Clock className="h-3 w-3" />;
}

function formatHours(h: number | null | undefined) {
  if (h == null || !Number.isFinite(h)) return null;
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h}h`;
  return `${Math.round((h / 24) * 10) / 10}d`;
}

export function ResponseSlaBadge({
  sla,
  className,
  compact,
}: {
  sla?: ResponseSla | null;
  className?: string;
  compact?: boolean;
}) {
  if (!sla) return null;
  const hoursLabel = formatHours(sla.hours);
  const sourceHint =
    sla.source === "invite_to_bid"
      ? "invite → bid"
      : sla.source === "job_to_bid"
        ? "job → bid"
        : null;
  const titleParts = [
    sla.label,
    hoursLabel ? `~${hoursLabel}` : null,
    sourceHint,
    sla.sampleSize ? `n=${sla.sampleSize}` : null,
  ].filter(Boolean);

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
        TIER_CLASS[sla.tier] || TIER_CLASS.unknown,
        className
      )}
      title={titleParts.join(" · ")}
    >
      <Icon tier={sla.tier} />
      {compact ? sla.label.replace(/ reply$/i, "") : sla.label}
      {hoursLabel && !compact ? (
        <span className="font-mono normal-case tracking-normal opacity-80">~{hoursLabel}</span>
      ) : null}
    </span>
  );
}
