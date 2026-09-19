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
    return `Pro has blocked ${dateKey} and is unavailable that day.`;
  }

  if (!weekly) return null;
  const day = JS_DAY_TO_KEY[start.getDay()];
  const slot = weekly[day];
  if (!slot || !slot.enabled) {
    return `Pro is typically unavailable on ${DAY_LABELS[day]}.`;
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
    return `Proposed time is outside the pro's usual ${DAY_LABELS[day]} window(s) (${desc}).`;
  }
  return null;
}

export function formatAvailabilitySummary(weekly?: WeeklyAvailability | null): string {
  if (!weekly) return "Not set";
  const parts = DAY_KEYS.filter((d) => weekly[d]?.enabled).map((d) => {
    const windows = dayWindows(weekly[d]);
    return `${DAY_LABELS[d]} ${windows.map((w) => `${w.start}–${w.end}`).join(" & ")}`;
  });
  return parts.length ? parts.join(" · ") : "No days marked available";
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

export type AvailabilityHeat = {
  days: DayHeat[];
  score: number;
  totalHours: number;
  clean: boolean;
};

export type BestInviteHint = {
  dayKey: string;
  dayLabel: string;
  date: string;
  start: string;
  end: string;
  reason: string;
};

function slotHours(slot: DaySlot | null | undefined): number {
  if (!slot || !slot.enabled) return 0;
  const windows = dayWindows(slot);
  let hours = 0;
  for (const w of windows) {
    const mins = toMinutes(w.end) - toMinutes(w.start);
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

/** Mini 7-day heat strip from weeklyAvailability (local calendar). */
export function buildAvailabilityHeat(
  weekly?: WeeklyAvailability | Partial<WeeklyAvailability> | null,
  blockedDates?: string[] | null
): AvailabilityHeat {
  const blocked = new Set((blockedDates || []).map((d) => String(d).slice(0, 10)));
  const clean =
    weekly != null &&
    typeof weekly === "object" &&
    DAY_KEYS.some((d) => {
    const day = (weekly as Record<string, unknown>)[d];
    return Boolean(day) && typeof day === "object";
  });
  const norm = clean ? normalizeWeeklyAvailability(weekly) : null;
  const now = new Date();
  const days: DayHeat[] = [];
  let totalHours = 0;
  const short: Record<DayKey, string> = {
    mon: "M",
    tue: "T",
    wed: "W",
    thu: "T",
    fri: "F",
    sat: "S",
    sun: "S",
  };
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const date = localDateKey(d);
    const key = JS_DAY_TO_KEY[d.getDay()];
    const isBlocked = blocked.has(date);
    const hours = isBlocked || !norm ? 0 : slotHours(norm[key]);
    totalHours += hours;
    days.push({
      key,
      label: short[key],
      date,
      enabled: !isBlocked && Boolean(norm?.[key]?.enabled),
      blocked: isBlocked,
      hours,
      level: hoursToLevel(hours),
    });
  }
  return {
    days,
    score: Math.min(100, Math.round((totalHours / 40) * 100)),
    totalHours: Math.round(totalHours * 10) / 10,
    clean: Boolean(clean),
  };
}

/** Soft best-invite hint when weeklyAvailability is clean. */
export function buildBestInviteHint(
  weekly?: WeeklyAvailability | Partial<WeeklyAvailability> | null,
  blockedDates?: string[] | null
): BestInviteHint | null {
  const heat = buildAvailabilityHeat(weekly, blockedDates);
  if (!heat.clean) return null;
  const full: Record<string, string> = {
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
    sun: "Sunday",
  };
  const candidates = heat.days
    .map((d, idx) => ({ ...d, idx }))
    .filter((d) => d.enabled && d.hours > 0 && !d.blocked);
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.hours - a.hours || a.idx - b.idx);
  const best = candidates[0];
  const norm = normalizeWeeklyAvailability(weekly);
  const windows = dayWindows(norm[best.key]);
  const win = [...windows].sort((a, b) => a.start.localeCompare(b.start))[0];
  const when = best.idx === 0 ? "today" : best.idx === 1 ? "tomorrow" : full[best.key];
  return {
    dayKey: best.key,
    dayLabel: full[best.key] || best.key,
    date: best.date,
    start: win.start,
    end: win.end,
    reason: `Best time to invite: ${when} ${win.start}–${win.end} (pro usually free then)`,
  };
}

/** Tailwind-ish heat cell class by level. */
export function heatLevelClass(level: number, blocked?: boolean): string {
  if (blocked) return "bg-slate-200 text-slate-400";
  if (level <= 0) return "bg-slate-100 text-slate-400";
  if (level === 1) return "bg-emerald-100 text-emerald-800";
  if (level === 2) return "bg-emerald-300 text-emerald-950";
  return "bg-emerald-500 text-white";
}
