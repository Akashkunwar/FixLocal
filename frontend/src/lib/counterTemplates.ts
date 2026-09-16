/** Pro counter-offer reply templates (localStorage + optional User sync). */

export type CounterTemplate = {
  id: string;
  label: string;
  body: string;
  createdAt: string;
};

const USER_KEY = "fixlocal_counter_templates";

function safeParse(raw: string | null): CounterTemplate[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((t: any, i: number) => ({
        id: String(t?.id || `ctr-${i}`),
        label: String(t?.label || "Template").slice(0, 80),
        body: String(t?.body || "").slice(0, 500),
        createdAt: String(t?.createdAt || new Date().toISOString()),
      }))
      .filter((t: CounterTemplate) => t.body.trim().length > 0)
      .slice(0, 20);
  } catch {
    return [];
  }
}

export function loadUserCounterTemplates(): CounterTemplate[] {
  return safeParse(localStorage.getItem(USER_KEY));
}

export function saveUserCounterTemplates(list: CounterTemplate[]) {
  localStorage.setItem(USER_KEY, JSON.stringify(list.slice(0, 20)));
}

export function deleteCounterTemplate(id: string) {
  saveUserCounterTemplates(loadUserCounterTemplates().filter((t) => t.id !== id));
}

export function upsertCounterTemplate(
  tpl: Omit<CounterTemplate, "createdAt"> & { createdAt?: string }
): CounterTemplate[] {
  const entry: CounterTemplate = {
    id: tpl.id || `ctr-${Date.now()}`,
    label: (tpl.label || "Template").trim().slice(0, 80) || "Template",
    body: (tpl.body || "").trim().slice(0, 500),
    createdAt: tpl.createdAt || new Date().toISOString(),
  };
  if (!entry.body) return loadUserCounterTemplates();
  const list = loadUserCounterTemplates().filter((t) => t.id !== entry.id);
  list.unshift(entry);
  saveUserCounterTemplates(list);
  return list;
}

/** Built-in starters: busy / materials / won't go below X. */
export const DEFAULT_COUNTER_STARTERS: CounterTemplate[] = [
  {
    id: "starter-busy",
    label: "Busy this week",
    body: "I'm booked this week — happy to revise if we can push the visit window, otherwise I'll have to pass on this counter.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "starter-materials",
    label: "Materials cost",
    body: "Materials are running higher than expected for this scope. I can meet closer if we trim materials/options, otherwise I can't go that low.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "starter-floor",
    label: "Won't go below X",
    body: "I won't go below ₹X for this scope — that's my floor after materials and travel. Happy to adjust scope if needed.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export function mergeCounterTemplates(
  server?: { id: string; label: string; body: string; createdAt?: string }[] | null
): CounterTemplate[] {
  const local = loadUserCounterTemplates();
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
    saveUserCounterTemplates(fromServer);
    return fromServer;
  }
  return DEFAULT_COUNTER_STARTERS;
}
