/** Client AMC / recurring request note templates (defaults + localStorage). */

export type AmcRequestNoteTemplate = {
  id: string;
  label: string;
  body: string;
  createdAt: string;
};

const USER_KEY = "fixlocal_amc_request_notes_v1";

function safeParse(raw: string | null): AmcRequestNoteTemplate[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((t: any, i: number) => ({
        id: String(t?.id || `amc-note-${i}`),
        label: String(t?.label || "Template").slice(0, 80),
        body: String(t?.body || "").slice(0, 500),
        createdAt: String(t?.createdAt || new Date().toISOString()),
      }))
      .filter((t: AmcRequestNoteTemplate) => t.body.trim().length > 0)
      .slice(0, 20);
  } catch {
    return [];
  }
}

export function loadAmcRequestNotes(): AmcRequestNoteTemplate[] {
  try {
    return safeParse(localStorage.getItem(USER_KEY));
  } catch {
    return [];
  }
}

export function saveAmcRequestNotes(list: AmcRequestNoteTemplate[]) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    /* quota */
  }
}

/** Built-in chips for client AMC request notes. */
export const DEFAULT_AMC_REQUEST_NOTES: AmcRequestNoteTemplate[] = [
  {
    id: "amc-monthly",
    label: "Prefer monthly",
    body: "Looking for a light monthly check — same scope as this job if possible. Soft request only; happy to refine in chat.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "amc-quarterly",
    label: "Quarterly AMC",
    body: "Interested in a quarterly AMC package covering inspection + minor fixes. Please confirm inclusions and visit window.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "amc-sla",
    label: "Response SLA",
    body: "Please include a soft response SLA (e.g. same-week visit) in the package note so we can plan around it.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "amc-budget",
    label: "Budget range",
    body: "Budget is roughly the range I filled — open to a small adjustment if materials or travel differ. Soft only.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export function mergeAmcRequestNotes(
  server?: { id: string; label: string; body: string; createdAt?: string }[] | null
): AmcRequestNoteTemplate[] {
  const local = loadAmcRequestNotes();
  const fromServer = Array.isArray(server)
    ? server.map((x) => ({
        id: x.id,
        label: x.label,
        body: x.body,
        createdAt: x.createdAt || new Date().toISOString(),
      }))
    : [];
  if (local.length) return local;
  if (fromServer.length) {
    saveAmcRequestNotes(fromServer);
    return fromServer;
  }
  return DEFAULT_AMC_REQUEST_NOTES;
}
