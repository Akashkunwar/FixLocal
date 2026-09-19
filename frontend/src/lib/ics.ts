import type { Job } from "../api/jobs";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Format as UTC ICS timestamp: YYYYMMDDTHHMMSSZ */
export function toIcsUtc(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Local wall-clock for TZID=Asia/Kolkata (demo default). */
export function toIcsLocal(iso: string | Date, timeZone = "Asia/Kolkata"): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}${get("month")}${get("day")}T${get("hour")}${get("minute")}${get("second")}`;
}

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function visitWindow(job: Job) {
  if (!job.scheduledStart) throw new Error("No confirmed visit start");
  const start = new Date(job.scheduledStart);
  const end = job.scheduledEnd
    ? new Date(job.scheduledEnd)
    : new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return { start, end };
}

function visitMeta(job: Job) {
  const loc = [job.address, job.area, job.city].filter(Boolean).join(", ");
  const descParts = [
    job.description?.slice(0, 400) || "",
    job.scheduleNote ? `Note: ${job.scheduleNote}` : "",
    `Job: ${job.title}`,
    `Open in FixLocal: /client/jobs/${job.id}`,
  ].filter(Boolean);
  return {
    loc,
    summary: `FixLocal visit — ${job.title}`,
    description: descParts.join("\n"),
  };
}

/** Simple fixed-offset VTIMEZONE for India Standard Time (no DST). */
const KOLKATA_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Asia/Kolkata",
  "X-LIC-LOCATION:Asia/Kolkata",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0530",
  "TZOFFSETTO:+0530",
  "TZNAME:IST",
  "DTSTART:19700101T000000",
  "END:STANDARD",
  "END:VTIMEZONE",
].join("\r\n");

export function buildVisitIcs(job: Job, timeZone = "Asia/Kolkata"): string {
  const { start, end } = visitWindow(job);
  const { loc, summary, description } = visitMeta(job);
  const uid = `fixlocal-visit-${job.id}@fixlocal.local`;
  const useLocal = timeZone === "Asia/Kolkata";

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FixLocal//Visit Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  if (useLocal) lines.push(KOLKATA_VTIMEZONE);
  lines.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${toIcsUtc(new Date())}`);
  if (useLocal) {
    lines.push(
      `DTSTART;TZID=${timeZone}:${toIcsLocal(start, timeZone)}`,
      `DTEND;TZID=${timeZone}:${toIcsLocal(end, timeZone)}`
    );
  } else {
    lines.push(`DTSTART:${toIcsUtc(start)}`, `DTEND:${toIcsUtc(end)}`);
  }
  lines.push(
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`
  );
  if (loc) lines.push(`LOCATION:${escapeIcsText(loc)}`);
  lines.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR", "");
  return lines.join("\r\n");
}

export function downloadVisitIcs(job: Job) {
  const ics = buildVisitIcs(job);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = (job.title || "visit").replace(/[^\w-]+/g, "_").slice(0, 40);
  a.download = `fixlocal-${safe}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function googleCalendarUrl(job: Job): string {
  const { start, end } = visitWindow(job);
  const { loc, summary, description } = visitMeta(job);
  const dates = `${toIcsUtc(start)}/${toIcsUtc(end)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: summary,
    dates,
    details: description,
  });
  if (loc) params.set("location", loc);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function outlookCalendarUrl(job: Job): string {
  const { start, end } = visitWindow(job);
  const { loc, summary, description } = visitMeta(job);
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: summary,
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    body: description,
  });
  if (loc) params.set("location", loc);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}


/** Soft next-visit hint after AMC accept — calendar stub only (no schedule write). */
export function buildAmcReminderIcs(
  job: Job,
  nextStartIso: string,
  opts?: { durationHours?: number; packageLabel?: string | null; cadence?: string | null }
): string {
  const start = new Date(nextStartIso);
  const end = new Date(start.getTime() + (opts?.durationHours ?? 2) * 60 * 60 * 1000);
  const loc = [job.address, job.area, job.city].filter(Boolean).join(", ");
  const pkg = opts?.packageLabel || job.amcProposal?.packageLabel || "Recurring visit";
  const cadence = opts?.cadence || job.amcProposal?.cadence || job.cadence || "monthly";
  const summary = `FixLocal next visit hint — ${job.title}`;
  const description = [
    `Soft reminder for accepted AMC / recurring interest.`,
    `Package: ${pkg}`,
    `Cadence: ${cadence}`,
    `Confirm the real date with your professional in chat.`,
    `Open in FixLocal: /client/jobs/${job.id}`,
  ].join("\n");
  const uid = `fixlocal-amc-hint-${job.id}@fixlocal.local`;
  const timeZone = "Asia/Kolkata";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FixLocal//AMC Next Visit Hint//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    KOLKATA_VTIMEZONE,
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART;TZID=${timeZone}:${toIcsLocal(start, timeZone)}`,
    `DTEND;TZID=${timeZone}:${toIcsLocal(end, timeZone)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
  ];
  if (loc) lines.push(`LOCATION:${escapeIcsText(loc)}`);
  lines.push("STATUS:TENTATIVE", "END:VEVENT", "END:VCALENDAR", "");
  return lines.join("\r\n");
}

export function downloadAmcReminderIcs(
  job: Job,
  nextStartIso: string,
  opts?: { packageLabel?: string | null; cadence?: string | null }
) {
  const ics = buildAmcReminderIcs(job, nextStartIso, opts);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = (job.title || "amc").replace(/[^\w-]+/g, "_").slice(0, 40);
  a.download = `fixlocal-amc-hint-${safe}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function googleAmcReminderUrl(job: Job, nextStartIso: string): string {
  const start = new Date(nextStartIso);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const loc = [job.address, job.area, job.city].filter(Boolean).join(", ");
  const pkg = job.amcProposal?.packageLabel || "Recurring visit";
  const summary = `FixLocal next visit hint — ${job.title}`;
  const description = `Soft AMC reminder (${pkg}). Confirm in chat.\n/client/jobs/${job.id}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: summary,
    dates: `${toIcsUtc(start)}/${toIcsUtc(end)}`,
    details: description,
  });
  if (loc) params.set("location", loc);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}


/** True when accepted AMC can include a confirmed schedule event + soft next-visit hint. */
export function hasAmcMultiEventStub(job: Job): boolean {
  return Boolean(job.scheduledStart && job.amcProposal?.status === "accepted");
}

/**
 * Soft multi-event ICS stub: confirmed visit (if scheduled) + tentative AMC next-visit hint.
 * Calendar stub only — does not write FixLocal schedule.
 */
export function buildAmcMultiEventIcs(
  job: Job,
  nextStartIso: string,
  opts?: { durationHours?: number; packageLabel?: string | null; cadence?: string | null }
): string {
  const timeZone = "Asia/Kolkata";
  const loc = [job.address, job.area, job.city].filter(Boolean).join(", ");
  const pkg = opts?.packageLabel || job.amcProposal?.packageLabel || "Recurring visit";
  const cadence = opts?.cadence || job.amcProposal?.cadence || job.cadence || "monthly";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FixLocal//AMC Multi Event Stub//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    KOLKATA_VTIMEZONE,
  ];

  if (job.scheduledStart) {
    const start = new Date(job.scheduledStart);
    const end = job.scheduledEnd
      ? new Date(job.scheduledEnd)
      : new Date(start.getTime() + 2 * 60 * 60 * 1000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:fixlocal-visit-${job.id}@fixlocal.local`,
      `DTSTAMP:${toIcsUtc(new Date())}`,
      `DTSTART;TZID=${timeZone}:${toIcsLocal(start, timeZone)}`,
      `DTEND;TZID=${timeZone}:${toIcsLocal(end, timeZone)}`,
      `SUMMARY:${escapeIcsText(`FixLocal visit — ${job.title}`)}`,
      `DESCRIPTION:${escapeIcsText(`Confirmed / proposed visit window.\nOpen: /client/jobs/${job.id}`)}`
    );
    if (loc) lines.push(`LOCATION:${escapeIcsText(loc)}`);
    lines.push("STATUS:CONFIRMED", "END:VEVENT");
  }

  const hintStart = new Date(nextStartIso);
  const hintEnd = new Date(
    hintStart.getTime() + (opts?.durationHours ?? 2) * 60 * 60 * 1000
  );
  lines.push(
    "BEGIN:VEVENT",
    `UID:fixlocal-amc-hint-${job.id}@fixlocal.local`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART;TZID=${timeZone}:${toIcsLocal(hintStart, timeZone)}`,
    `DTEND;TZID=${timeZone}:${toIcsLocal(hintEnd, timeZone)}`,
    `SUMMARY:${escapeIcsText(`FixLocal next visit hint — ${job.title}`)}`,
    `DESCRIPTION:${escapeIcsText(
      `Soft AMC reminder (${pkg}, ${cadence}). Confirm in chat.\n/client/jobs/${job.id}`
    )}`
  );
  if (loc) lines.push(`LOCATION:${escapeIcsText(loc)}`);
  lines.push("STATUS:TENTATIVE", "END:VEVENT", "END:VCALENDAR", "");
  return lines.join("\r\n");
}

export function downloadAmcMultiEventIcs(
  job: Job,
  nextStartIso: string,
  opts?: { packageLabel?: string | null; cadence?: string | null }
) {
  const icsBody = buildAmcMultiEventIcs(job, nextStartIso, opts);
  const blob = new Blob([icsBody], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = (job.title || "amc").replace(/[^\w-]+/g, "_").slice(0, 40);
  a.download = `fixlocal-amc-multi-${safe}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
