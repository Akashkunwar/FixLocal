import { localDatesAhead } from "../domain/time";

/** Availability heat helpers (7-day strip + score) for browse / shortlist / invites. */

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export type DayHeat = {
  key: string;
  label: string;
  date: string;
  enabled: boolean;
  blocked: boolean;
  hours: number;
  level: number; // 0 none · 1 light · 2 medium · 3 heavy
};

export type AvailabilityHeat = {
  days: DayHeat[];
  score: number;
  totalHours: number;
  clean: boolean;
};

export function slotHours(slot: {
  enabled?: boolean;
  start?: string;
  end?: string;
  slots?: { start: string; end: string }[];
} | null | undefined): number {
  if (!slot || !slot.enabled) return 0;
  const windows =
    Array.isArray(slot.slots) && slot.slots.length
      ? slot.slots
      : slot.start && slot.end
        ? [{ start: slot.start, end: slot.end }]
        : [];
  let hours = 0;
  for (const w of windows) {
    const [sh, sm] = String(w.start || "0").split(":").map(Number);
    const [eh, em] = String(w.end || "0").split(":").map(Number);
    const mins = (eh || 0) * 60 + (em || 0) - ((sh || 0) * 60 + (sm || 0));
    if (mins > 0) hours += mins / 60;
  }
  return Math.round(hours * 10) / 10;
}

function hoursToLevel(hours: number): number {
  if (hours <= 0) return 0;
  if (hours < 3) return 1;
  if (hours < 6) return 2;
  return 3;
}

/** 7-day availability strip in the pro's time zone. */
export function buildAvailabilityHeat(
  weekly: Record<string, { enabled?: boolean; start?: string; end?: string; slots?: { start: string; end: string }[] } | undefined> | null | undefined,
  blockedDates?: string[] | null,
  timezone?: string | null,
  now: Date = new Date()
): AvailabilityHeat {
  const blocked = new Set((blockedDates || []).map((d) => String(d).slice(0, 10)));
  const labels: Record<string, string> = { mon: "M", tue: "T", wed: "W", thu: "T", fri: "F", sat: "S", sun: "S" };
  const clean =
    weekly != null &&
    typeof weekly === "object" &&
    DAY_KEYS.some((d) => weekly[d] && typeof weekly[d] === "object");
  let totalHours = 0;
  const days: DayHeat[] = localDatesAhead(7, timezone, now).map(({ date, dayKey }) => {
    const isBlocked = blocked.has(date);
    const hours = isBlocked || !clean ? 0 : slotHours(weekly?.[dayKey]);
    totalHours += hours;
    return {
      key: dayKey,
      label: labels[dayKey] || dayKey[0].toUpperCase(),
      date,
      enabled: !isBlocked && Boolean(weekly?.[dayKey]?.enabled),
      blocked: isBlocked,
      hours,
      level: hoursToLevel(hours),
    };
  });
  const score = Math.min(100, Math.round((totalHours / 40) * 100));
  return { days, score, totalHours: Math.round(totalHours * 10) / 10, clean };
}

/** Default min heat for shortlist invites when schedule is clean. */
export const DEFAULT_SHORTLIST_INVITE_MIN_HEAT = 25;

/**
 * Gate shortlist invites: if heat is clean, require score >= minHeat.
 * Unclean / missing schedule does not block.
 */
export function shortlistInviteBlockedByHeat(
  heat: AvailabilityHeat | null | undefined,
  minHeat: number = DEFAULT_SHORTLIST_INVITE_MIN_HEAT
): { blocked: boolean; reason?: string; heat?: AvailabilityHeat | null; minHeat: number } {
  const threshold = Number.isFinite(minHeat) && minHeat > 0 ? minHeat : DEFAULT_SHORTLIST_INVITE_MIN_HEAT;
  if (!heat || !heat.clean) {
    return { blocked: false, heat: heat || null, minHeat: threshold };
  }
  const score = Number(heat.score || 0);
  if (score >= threshold) {
    return { blocked: false, heat, minHeat: threshold };
  }
  return {
    blocked: true,
    reason: `Shortlist invite needs availability heat ≥${threshold} (pro has ${score}). Ease the gate or wait until their schedule opens up.`,
    heat,
    minHeat: threshold,
  };
}

/** Hours before a soft "viewed but no reply" nudge after quote-viewed. */
export function quoteViewNudgeHours(): number {
  const raw = Number(process.env.QUOTE_VIEW_NUDGE_HOURS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 4; // demo-friendly default
}

/** Clamp user/env nudge hours into a sane 1–168h window. */
export function resolveQuoteViewNudgeHours(userHours?: number | null): number {
  const fromUser = Number(userHours);
  if (Number.isFinite(fromUser) && fromUser >= 1 && fromUser <= 168) {
    return Math.round(fromUser);
  }
  return quoteViewNudgeHours();
}
