import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { HI } from "./i18n-hi";

/**
 * Lightweight English/Hindi switch. Keys are the English text itself, so untranslated strings
 * simply stay in English. Only the core surfaces are translated for now (nav, landing, log-in,
 * sign-up, footer, settings language card); see i18n-hi.ts.
 */
export type Lang = "en" | "hi";
export const LANG_KEY = "fixlocal:lang";
export const HTML_LANG: Record<Lang, string> = { en: "en-IN", hi: "hi" };

export function translate(lang: Lang, text: string): string {
  return lang === "hi" ? (HI[text] ?? text) : text;
}

function initialLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === "hi" ? "hi" : "en";
  } catch {
    return "en";
  }
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (text: string) => string };
const I18nContext = createContext<Ctx>({ lang: "en", setLang: () => undefined, t: (s) => s });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = HTML_LANG[lang];
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* private mode: applies to this visit only */
    }
  }, []);
  const t = useCallback((text: string) => translate(lang, text), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

/** Header button: shows the *other* language, written in that language. */
export function LanguageToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useI18n();
  const next: Lang = lang === "en" ? "hi" : "en";
  return (
    <button
      type="button"
      className={`rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 ${className}`}
      onClick={() => setLang(next)}
      aria-label={next === "hi" ? "हिन्दी में देखें (View in Hindi)" : "View in English (अंग्रेज़ी में देखें)"}
    >
      <span lang={HTML_LANG[next]}>{next === "hi" ? "हिन्दी" : "English"}</span>
    </button>
  );
}
