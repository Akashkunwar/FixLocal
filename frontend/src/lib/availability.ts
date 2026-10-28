import { plural, t, tf } from "./t";
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type TimeWindow = { start: string; end: string };

export type DaySlot = {
  enabled: boolean;
  start: string; // HH:mm — primary / first slot (compat)
  end: string;
  slots?: TimeWindow[];
};

export type WeeklyAvailability = Record<DayKey, DaySlot>;

export const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const DAY_LABELS: Record<DayKey, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

export function defaultWeeklyAvailability(): WeeklyAvailability {
  const weekday: DaySlot = {
    enabled: true,
    start: "09:00",
    end: "18:00",
    slots: [{ start: "09:00", end: "18:00" }],
  };
  const weekend: DaySlot = {
    enabled: false,
    start: "10:00",
    end: "14:00",
    slots: [{ start: "10:00", end: "14:00" }],
  };
  return {
    mon: { ...weekday, slots: [{ start: "09:00", end: "18:00" }] },
    tue: { ...weekday, slots: [{ start: "09:00", end: "18:00" }] },
    wed: { ...weekday, slots: [{ start: "09:00", end: "18:00" }] },
    thu: { ...weekday, slots: [{ start: "09:00", end: "18:00" }] },
    fri: { ...weekday, slots: [{ start: "09:00", end: "18:00" }] },
    sat: { enabled: true, start: "10:00", end: "14:00", slots: [{ start: "10:00", end: "14:00" }] },
    sun: { ...weekend, slots: [{ start: "10:00", end: "14:00" }] },
  };
}

function dayWindows(slot: DaySlot): TimeWindow[] {
  if (slot.slots && slot.slots.length) return slot.slots;
  return [{ start: slot.start, end: slot.end }];
}

export function normalizeWeeklyAvailability(
  raw?: Partial<WeeklyAvailability> | null
): WeeklyAvailability {
  const base = defaultWeeklyAvailability();
  if (!raw) return base;
  for (const day of DAY_KEYS) {
    const slot = raw[day];
    if (!slot) continue;
    let slots = Array.isArray(slot.slots)
      ? slot.slots.map((s) => ({
          start: String(s.start || "09:00").slice(0, 5),
          end: String(s.end || "17:00").slice(0, 5),
        }))
      : [];
    if (!slots.length) {
      slots = [
        {
          start: String(slot.start || base[day].start).slice(0, 5),
          end: String(slot.end || base[day].end).slice(0, 5),
        },
      ];
    }
    slots = slots.slice(0, 4);
    base[day] = {
      enabled: Boolean(slot.enabled),
      start: slots[0].start,
      end: slots[0].end,
      slots,
    };
  }
  return base;
}

const JS_DAY_TO_KEY: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Returns a short conflict hint, or null if the window looks fine / no schedule set. */
export function availabilityConflictHint(
  weekly: WeeklyAvailability | null | undefined,
  startIso: string,
  endIso?: string,
  blockedDates?: string[] | null
): string | null {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return null;

  const dateKey = localDateKey(start);
  if (blockedDates?.includes(dateKey)) {
    return tf("Pro has blocked {date} and is unavailable that day.", { date: dateKey });
  }

  if (!weekly) return null;
  const day = JS_DAY_TO_KEY[start.getDay()];
  const slot = weekly[day];
  if (!slot || !slot.enabled) {
    return tf("Pro is typically unavailable on {day}.", { day: t(DAY_LABELS[day]) });
  }
  const startMin = start.getHours() * 60 + start.getMinutes();
  const end = endIso ? new Date(endIso) : null;
  const endMin =
    end && !Number.isNaN(end.getTime())
      ? end.getHours() * 60 + end.getMinutes()
      : startMin + 120;

  const windows = dayWindows(slot);
  const fits = windows.some((w) => {
    const a = toMinutes(w.start);
    const b = toMinutes(w.end);
    return startMin >= a && endMin <= b;
  });
  if (!fits) {
    const desc = windows.map((w) => `${w.start}–${w.end}`).join(", ");
    return plural(windows.length, "Proposed time is outside the pro's usual {day} window ({times}).", "Proposed time is outside the pro's usual {day} windows ({times}).", { day: t(DAY_LABELS[day]), times: desc });
  }
  return null;
}

export function formatAvailabilitySummary(weekly?: WeeklyAvailability | null): string {
  if (!weekly) return t("Not set");
  const parts = DAY_KEYS.filter((d) => weekly[d]?.enabled).map((d) => {
    const windows = dayWindows(weekly[d]);
    return `${t(DAY_LABELS[d])} ${windows.map((w) => `${w.start}–${w.end}`).join(" & ")}`;
  });
  return parts.length ? parts.join(" · ") : t("No days marked available");
}


export type DayHeat = {
  key: DayKey;
  label: string;
  date: string;
  enabled: boolean;
  blocked: boolean;
  hours: number;
  level: number;
};

const FULL_DAY: Record<string, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/**
 * "Best time to invite: today 09:00–18:00 …" built from the hint's fields, so it is translated
 * (the server's `reason` is English-only).
 */
export function bestInviteText(h: { dayKey: string; date: string; start: string; end: string }, now = new Date()): string {
  const today = localDateKey(now);
  const tomorrow = localDateKey(new Date(now.getTime() + 86_400_000));
  const when = h.date === today ? t("today") : h.date === tomorrow ? t("tomorrow") : t(FULL_DAY[h.dayKey] || h.dayKey);
  return tf("Best time to invite: {when} {start}–{end} (pro usually free then)", { when, start: h.start, end: h.end });
}

/** Tailwind-ish heat cell class by level. */
export function heatLevelClass(level: number, blocked?: boolean): string {
  if (blocked) return "bg-slate-200 text-slate-500";
  if (level <= 0) return "bg-slate-100 text-slate-500";
  if (level === 1) return "bg-emerald-100 text-emerald-800";
  if (level === 2) return "bg-emerald-300 text-emerald-950";
  return "bg-emerald-500 text-white";
}
