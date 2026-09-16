/** Homeowner counter-offer / request-revise note templates (localStorage + User sync). */

export type HomeownerCounterNoteTemplate = {
  id: string;
  label: string;
  body: string;
  createdAt: string;
};

const USER_KEY = "fixlocal_homeowner_counter_notes";

function safeParse(raw: string | null): HomeownerCounterNoteTemplate[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((t: any, i: number) => ({
        id: String(t?.id || `ho-ctr-${i}`),
        label: String(t?.label || "Template").slice(0, 80),
        body: String(t?.body || "").slice(0, 500),
        createdAt: String(t?.createdAt || new Date().toISOString()),
      }))
      .filter((t: HomeownerCounterNoteTemplate) => t.body.trim().length > 0)
      .slice(0, 20);
  } catch {
    return [];
  }
}

export function loadHomeownerCounterNotes(): HomeownerCounterNoteTemplate[] {
  return safeParse(localStorage.getItem(USER_KEY));
}

export function saveHomeownerCounterNotes(list: HomeownerCounterNoteTemplate[]) {
  localStorage.setItem(USER_KEY, JSON.stringify(list.slice(0, 20)));
}

export function deleteHomeownerCounterNote(id: string) {
  saveHomeownerCounterNotes(loadHomeownerCounterNotes().filter((t) => t.id !== id));
}

export function upsertHomeownerCounterNote(
  tpl: Omit<HomeownerCounterNoteTemplate, "createdAt"> & { createdAt?: string }
): HomeownerCounterNoteTemplate[] {
  const entry: HomeownerCounterNoteTemplate = {
    id: tpl.id || `ho-ctr-${Date.now()}`,
    label: (tpl.label || "Template").trim().slice(0, 80) || "Template",
    body: (tpl.body || "").trim().slice(0, 500),
    createdAt: tpl.createdAt || new Date().toISOString(),
  };
  if (!entry.body) return loadHomeownerCounterNotes();
  const list = loadHomeownerCounterNotes().filter((t) => t.id !== entry.id);
  list.unshift(entry);
  saveHomeownerCounterNotes(list);
  return list;
}

/** Built-in chips for request-revise notes. */
export const DEFAULT_HOMEOWNER_COUNTER_NOTES: HomeownerCounterNoteTemplate[] = [
  {
    id: "ho-budget",
    label: "Budget tight",
    body: "My budget is a bit tighter than this quote — could you revise closer to the suggested amount if we keep the same scope?",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "ho-scope",
    label: "Smaller scope",
    body: "Happy to trim scope slightly if that helps you meet closer to my suggested amount. Let me know what you'd drop first.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "ho-timeline",
    label: "Flexible timing",
    body: "I'm flexible on timing if that helps on price — open to a later visit window for a revised quote near my suggestion.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "ho-match",
    label: "Meet in middle",
    body: "Can we meet in the middle? I've suggested an amount that works for me — open to a small adjustment either way.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export function mergeHomeownerCounterNotes(
  server?: { id: string; label: string; body: string; createdAt?: string }[] | null
): HomeownerCounterNoteTemplate[] {
  const local = loadHomeownerCounterNotes();
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
    saveHomeownerCounterNotes(fromServer);
    return fromServer;
  }
  return DEFAULT_HOMEOWNER_COUNTER_NOTES;
}
