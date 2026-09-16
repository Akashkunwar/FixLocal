import type { Job } from "../api/jobs";

export type VisitPrepItem = {
  id: string;
  label: string;
  hint?: string;
  /** Soft auto-check when job already has the data */
  autoDone?: boolean;
};

const prepKey = (jobId: string) => `fixlocal:visit-prep:${jobId}`;

export function visitPrepItems(job: Job): VisitPrepItem[] {
  const hasAddress = !!(job.address || job.area || job.city);
  const hasPhotos = Array.isArray(job.photoUrls) && job.photoUrls.length > 0;
  const hasWindow = !!(job.scheduledStart || job.preferredStart);
  const hasNote = !!(job.scheduleNote && job.scheduleNote.trim());

  return [
    {
      id: "address",
      label: "Confirm address & access",
      hint: hasAddress
        ? [job.address, job.area, job.city].filter(Boolean).join(" · ")
        : "Add or confirm the visit address on the job.",
      autoDone: hasAddress,
    },
    {
      id: "window",
      label: "Confirm visit window",
      hint: hasWindow
        ? "Proposed or preferred time is on the schedule card."
        : "Propose or accept a visit time with the professional.",
      autoDone: hasWindow && (job.scheduleStatus === "confirmed" || job.scheduleStatus === "proposed"),
    },
    {
      id: "parking",
      label: "Parking / building entry notes",
      hint: hasNote
        ? "Schedule note is set — share gate codes or parking tips in chat if needed."
        : "Share parking, gate code, or lobby instructions in the schedule note or chat.",
      autoDone: hasNote,
    },
    {
      id: "photos",
      label: "Photos ready for the pro",
      hint: hasPhotos
        ? `${job.photoUrls.length} photo(s) on the job.`
        : "Upload clear photos of the work area so the pro can prepare.",
      autoDone: hasPhotos,
    },
    {
      id: "space",
      label: "Clear the work area",
      hint: "Move valuables, secure pets, and free access to the work space.",
    },
    {
      id: "contact",
      label: "Be reachable during the window",
      hint: "Keep your phone handy or leave an alternate contact in chat.",
    },
  ];
}

export function loadVisitPrepChecks(jobId: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(prepKey(jobId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveVisitPrepChecks(jobId: string, checks: Record<string, boolean>) {
  localStorage.setItem(prepKey(jobId), JSON.stringify(checks));
}


const proPrepKey = (jobId: string) => `fixlocal:pro-visit-day:${jobId}`;

/** Professional visit-day checklist (mirrors client VisitPrepCard). */
export function proVisitDayItems(job: Job): VisitPrepItem[] {
  const hasPhotos = Array.isArray(job.photoUrls) && job.photoUrls.length > 0;
  const hasWindow = !!(job.scheduledStart || job.preferredStart);
  const hasAddress = !!(job.address || job.area || job.city);
  const hasNote = !!(job.scheduleNote && job.scheduleNote.trim());
  const confirmed = job.scheduleStatus === "confirmed";

  return [
    {
      id: "brief",
      label: "Review job brief & photos",
      hint: hasPhotos
        ? `${job.photoUrls.length} photo(s) on the job — check details before you leave.`
        : "Read the description carefully; ask the client for photos in chat if needed.",
      autoDone: hasPhotos,
    },
    {
      id: "tools",
      label: "Pack tools & materials",
      hint: "Match the specialty (parts, PPE, spare fittings) to avoid a second trip.",
    },
    {
      id: "route",
      label: "Confirm address & travel time",
      hint: hasAddress
        ? [job.address, job.area, job.city].filter(Boolean).join(" · ")
        : "Confirm the visit address with the client in chat.",
      autoDone: hasAddress,
    },
    {
      id: "window",
      label: "Confirm visit window",
      hint: confirmed
        ? "Visit is confirmed — arrive in the agreed window."
        : hasWindow
          ? "Window proposed — confirm with the client if still pending."
          : "Propose or accept a visit time on the schedule card.",
      autoDone: confirmed || (hasWindow && job.scheduleStatus === "proposed"),
    },
    {
      id: "access",
      label: "Parking / access notes",
      hint: hasNote
        ? "Schedule note is set — check gate codes or parking tips."
        : "Ask about parking, gate code, or lobby entry before you arrive.",
      autoDone: hasNote,
    },
    {
      id: "reach",
      label: "Be reachable / message if delayed",
      hint: "Keep your phone on and ping the client in chat if you are running late.",
    },
  ];
}

export function loadProVisitDayChecks(jobId: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(proPrepKey(jobId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveProVisitDayChecks(jobId: string, checks: Record<string, boolean>) {
  localStorage.setItem(proPrepKey(jobId), JSON.stringify(checks));
}
