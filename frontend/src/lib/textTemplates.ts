/**
 * Saved text snippets (invite notes, counter replies, intro messages).
 * The account is the only store: these helpers are pure, and callers persist
 * the returned list with AuthContext.updateProfile. Nothing is kept in
 * localStorage, so templates never leak between people sharing a browser.
 */
export type TextTemplate = {
  id: string;
  label: string;
  body: string;
  createdAt: string;
};

type RawTemplate = { id?: string; label?: string; body?: string; createdAt?: string } | null | undefined;

export const MAX_TEXT_TEMPLATES = 20;

export function normalizeTextTemplates(raw: readonly RawTemplate[] | null | undefined): TextTemplate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is NonNullable<RawTemplate> => !!t && typeof t === "object")
    .map((t, i) => ({
      id: String(t.id || `tpl-${i}`).slice(0, 64),
      label: String(t.label || "Template").trim().slice(0, 80) || "Template",
      body: String(t.body || "").trim().slice(0, 500),
      createdAt: String(t.createdAt || new Date(0).toISOString()),
    }))
    .filter((t) => t.body.length > 0)
    .slice(0, MAX_TEXT_TEMPLATES);
}

/** What the user sees: their saved list, or the built-in starters when they have none. */
export function accountTextTemplates(server: readonly RawTemplate[] | null | undefined, defaults: TextTemplate[]) {
  const saved = normalizeTextTemplates(server);
  return saved.length ? saved : defaults;
}

export function newTemplateId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Insert or replace an entry (newest first). Empty bodies leave the list unchanged. */
export function upsertTextTemplate(
  list: TextTemplate[],
  entry: { id?: string | null; label?: string; body: string },
  prefix = "tpl"
): TextTemplate[] {
  const body = entry.body.trim().slice(0, 500);
  if (!body) return list;
  const existing = entry.id ? list.find((t) => t.id === entry.id) : undefined;
  const next: TextTemplate = {
    id: existing?.id || entry.id || newTemplateId(prefix),
    label: (entry.label || "").trim().slice(0, 80) || "Template",
    body,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  if (existing) return list.map((t) => (t.id === next.id ? next : t));
  return [next, ...list].slice(0, MAX_TEXT_TEMPLATES);
}

export function removeTextTemplate(list: TextTemplate[], id: string): TextTemplate[] {
  return list.filter((t) => t.id !== id);
}
