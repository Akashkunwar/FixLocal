/** Pro intro / first-message templates for in-job chat (localStorage + optional User sync). */

export type IntroTemplate = {
  id: string;
  label: string;
  body: string;
  createdAt: string;
};

const USER_KEY = "fixlocal_intro_templates";

function safeParse(raw: string | null): IntroTemplate[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((t: any, i: number) => ({
        id: String(t?.id || `intro-${i}`),
        label: String(t?.label || "Template").slice(0, 80),
        body: String(t?.body || "").slice(0, 500),
        createdAt: String(t?.createdAt || new Date().toISOString()),
      }))
      .filter((t: IntroTemplate) => t.body.trim().length > 0)
      .slice(0, 20);
  } catch {
    return [];
  }
}

export function loadUserIntroTemplates(): IntroTemplate[] {
  return safeParse(localStorage.getItem(USER_KEY));
}

export function saveUserIntroTemplates(list: IntroTemplate[]) {
  localStorage.setItem(USER_KEY, JSON.stringify(list.slice(0, 20)));
}

export function upsertIntroTemplate(
  tpl: Omit<IntroTemplate, "createdAt"> & { createdAt?: string }
): IntroTemplate[] {
  const entry: IntroTemplate = {
    id: tpl.id || `intro-${Date.now()}`,
    label: (tpl.label || "Template").trim().slice(0, 80) || "Template",
    body: (tpl.body || "").trim().slice(0, 500),
    createdAt: tpl.createdAt || new Date().toISOString(),
  };
  if (!entry.body) return loadUserIntroTemplates();
  const list = loadUserIntroTemplates().filter((t) => t.id !== entry.id);
  list.unshift(entry);
  saveUserIntroTemplates(list);
  return list;
}

export function deleteIntroTemplate(id: string) {
  saveUserIntroTemplates(loadUserIntroTemplates().filter((t) => t.id !== id));
}

export const DEFAULT_INTRO_STARTERS: IntroTemplate[] = [
  {
    id: "intro-hello",
    label: "Hello + ETA",
    body: "Hi! Thanks for awarding the job. I can share an ETA once we confirm the visit window — happy to answer any questions beforehand.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "intro-prep",
    label: "What to prep",
    body: "Looking forward to the visit. Please keep access clear and note any parking / entry instructions. I’ll bring the usual tools for this specialty.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "intro-photos",
    label: "Photos help",
    body: "Thanks for hiring me. Extra photos of the work area before I arrive help me plan materials — feel free to drop them here.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export function mergeIntroTemplates(
  server?: { id: string; label: string; body: string; createdAt?: string }[] | null
): IntroTemplate[] {
  const local = loadUserIntroTemplates();
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
    saveUserIntroTemplates(fromServer);
    return fromServer;
  }
  return DEFAULT_INTRO_STARTERS;
}
