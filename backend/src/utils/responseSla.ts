/** Response SLA badges from invite→bid and/or job-created→bid latency. */

export type ResponseSlaTier =
  | "lightning"
  | "fast"
  | "same_day"
  | "steady"
  | "slow"
  | "unknown";

export type ResponseSlaBadge = {
  tier: ResponseSlaTier;
  label: string;
  /** Primary hours used for the badge (prefer invite→bid when present). */
  hours: number | null;
  source: "invite_to_bid" | "job_to_bid" | "none";
  sampleSize: number;
  inviteAvgHours: number | null;
  jobAvgHours: number | null;
  inviteSampleSize: number;
  jobSampleSize: number;
};

const TIER_META: Record<
  Exclude<ResponseSlaTier, "unknown">,
  { label: string; maxHours: number }
> = {
  lightning: { label: "Lightning reply", maxHours: 2 },
  fast: { label: "Fast reply", maxHours: 6 },
  same_day: { label: "Same-day reply", maxHours: 24 },
  steady: { label: "Steady reply", maxHours: 48 },
  slow: { label: "Slow reply", maxHours: Infinity },
};

export function tierFromHours(hours: number | null | undefined): ResponseSlaTier {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return "unknown";
  if (hours <= 2) return "lightning";
  if (hours <= 6) return "fast";
  if (hours <= 24) return "same_day";
  if (hours <= 48) return "steady";
  return "slow";
}

export function labelForTier(tier: ResponseSlaTier): string {
  if (tier === "unknown") return "New / no SLA yet";
  return TIER_META[tier].label;
}

export function avgHours(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

/** Build badge preferring invite→bid latency, falling back to job→bid. */
export function buildResponseSla(opts: {
  inviteHours?: number[];
  jobHours?: number[];
}): ResponseSlaBadge {
  const inviteHours = (opts.inviteHours || []).filter((h) => Number.isFinite(h) && h >= 0);
  const jobHours = (opts.jobHours || []).filter((h) => Number.isFinite(h) && h >= 0);
  const inviteAvg = avgHours(inviteHours);
  const jobAvg = avgHours(jobHours);

  let hours: number | null = null;
  let source: ResponseSlaBadge["source"] = "none";
  let sampleSize = 0;

  if (inviteAvg != null) {
    hours = inviteAvg;
    source = "invite_to_bid";
    sampleSize = inviteHours.length;
  } else if (jobAvg != null) {
    hours = jobAvg;
    source = "job_to_bid";
    sampleSize = jobHours.length;
  }

  const tier = tierFromHours(hours);
  return {
    tier,
    label: labelForTier(tier),
    hours,
    source,
    sampleSize,
    inviteAvgHours: inviteAvg,
    jobAvgHours: jobAvg,
    inviteSampleSize: inviteHours.length,
    jobSampleSize: jobHours.length,
  };
}

/** Single-event SLA (e.g. this bid's invite→bid or job→bid). */
export function buildEventSla(opts: {
  inviteToBidHours?: number | null;
  jobToBidHours?: number | null;
}): ResponseSlaBadge {
  const invite =
    opts.inviteToBidHours != null && Number.isFinite(opts.inviteToBidHours)
      ? [opts.inviteToBidHours]
      : [];
  const job =
    opts.jobToBidHours != null && Number.isFinite(opts.jobToBidHours)
      ? [opts.jobToBidHours]
      : [];
  return buildResponseSla({ inviteHours: invite, jobHours: job });
}

export function hoursBetween(from: Date | string | null | undefined, to: Date | string | null | undefined): number | null {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  const h = (b - a) / 3600000;
  // Ignore absurd outliers (>14 days) for SLA display
  if (h > 14 * 24) return null;
  return Math.round(h * 10) / 10;
}

const TIER_RANK: Record<ResponseSlaTier, number> = {
  lightning: 0,
  fast: 1,
  same_day: 2,
  steady: 3,
  slow: 4,
  unknown: 99,
};

export function tierRank(tier: ResponseSlaTier | string): number {
  return TIER_RANK[tier as ResponseSlaTier] ?? 99;
}

/** True when new tier is strictly faster than previous (unknown never improves). */
export function isTierImproved(
  prev: ResponseSlaTier | string | null | undefined,
  next: ResponseSlaTier | string | null | undefined
): boolean {
  if (!prev || !next) return false;
  if (prev === "unknown" || next === "unknown") return false;
  return tierRank(next) < tierRank(prev);
}

export function maxHoursForTier(tier: ResponseSlaTier | string): number | null {
  if (tier === "lightning") return 2;
  if (tier === "fast") return 6;
  if (tier === "same_day") return 24;
  if (tier === "steady") return 48;
  if (tier === "slow") return Infinity;
  return null;
}

export type SlaTrends = {
  d7: ResponseSlaBadge;
  d30: ResponseSlaBadge;
  /** Enough samples to show on bid compare (d30 n>=2, or d7 n>=2). */
  clean: boolean;
};

/** Filter hour samples whose event time falls within the last `days` days. */
export function filterHoursInWindow(
  samples: { hours: number; at: Date | string }[],
  days: number,
  now: Date = new Date()
): number[] {
  const cutoff = now.getTime() - days * 86400000;
  return samples
    .filter((s) => {
      const t = new Date(s.at).getTime();
      return Number.isFinite(t) && t >= cutoff && Number.isFinite(s.hours) && s.hours >= 0;
    })
    .map((s) => s.hours);
}

export function buildSlaTrends(
  samples: { hours: number; at: Date | string }[],
  now: Date = new Date()
): SlaTrends {
  const d7 = buildResponseSla({ jobHours: filterHoursInWindow(samples, 7, now) });
  const d30 = buildResponseSla({ jobHours: filterHoursInWindow(samples, 30, now) });
  const clean = (d30.sampleSize >= 2 && d30.tier !== "unknown") || (d7.sampleSize >= 2 && d7.tier !== "unknown");
  return { d7, d30, clean };
}

