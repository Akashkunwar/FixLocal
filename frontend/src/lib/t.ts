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
