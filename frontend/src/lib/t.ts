/**
 * Translation core (no React): the current language, the lazily loaded Hindi dictionary, and
 * `t()`. Keys are the English text itself, so anything untranslated simply stays in English.
 */
export type Lang = "en" | "hi";

let dict: Record<string, string> | null = null;
let loading: Promise<void> | null = null;
let current: Lang = "en";

/** Fetch the Hindi strings (once). They live in their own chunk so English users never load them. */
export function loadHindi(): Promise<void> {
  if (dict) return Promise.resolve();
  loading ??= import("./i18n-hi")
    .then((m) => {
      dict = m.HI;
    })
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}

export const hindiReady = () => dict !== null;

/** True when `text` has a Hindi entry (lets callers prefer a translated server message). */
export const hasTranslation = (text: string) => !!dict && Object.prototype.hasOwnProperty.call(dict, text);

export function translate(lang: Lang, text: string): string {
  if (lang !== "hi" || !dict) return text;
  const hit = dict[text];
  if (hit) return hit;
  const job = /^New job: (.+)$/.exec(text); // job-alert notification titles carry the job title
  return job ? `${dict["New job:"] ?? "New job:"} ${job[1]}` : text;
}

/** Translate a UI string into the current language. */
export function t(text: string): string {
  return translate(current, text);
}

export const currentLang = () => current;
export function setCurrentLang(l: Lang) {
  current = l;
}

/** Fill `{name}` placeholders. Numbers are formatted for the current language's locale. */
export function interpolate(text: string, params: Record<string, string | number | null | undefined> = {}): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = params[key];
    if (v === undefined || v === null) return whole;
    return typeof v === "number" ? v.toLocaleString(current === "hi" ? "hi-IN" : "en-IN") : v;
  });
}

/** Translate a template, then fill it (the dictionary key keeps the {placeholders}). */
export function tf(text: string, params: Record<string, string | number | null | undefined>): string {
  return interpolate(translate(current, text), params);
}

const pluralRules: Partial<Record<Lang, Intl.PluralRules>> = {};

/**
 * Plural-aware text built on Intl.PluralRules (ux MED 5). Pass the English singular and plural
 * templates with `{n}`; each is a dictionary key, so Hindi gets its own wording rather than an
 * English "s" glued on: 3 bids → "3 बोलियाँ".
 */
export function plural(
  n: number,
  one: string,
  other: string,
  params: Record<string, string | number | null | undefined> = {}
): string {
  const rules = (pluralRules[current] ??= new Intl.PluralRules(current === "hi" ? "hi-IN" : "en-IN"));
  const form = rules.select(n) === "one" ? one : other;
  return interpolate(translate(current, form), { n, ...params });
}
