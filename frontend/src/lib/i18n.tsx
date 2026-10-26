import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { updateMe } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  hindiReady,
  loadHindi,
  setCurrentLang,
  translate,
  type Lang,
} from "./t";

/**
 * English/Hindi switch. Keys are the English text itself, so anything untranslated stays in
 * English. The Hindi dictionary (lib/i18n-hi.ts) is a separate chunk, loaded only when Hindi is
 * chosen. `t()` is a plain function: switching language remounts the app below the provider so
 * every component re-renders in the new language.
 *
 * Where the choice lives: on the account when logged in (synced across devices), and in
 * localStorage on this device (used when logged out and as the start-up language).
 */
export { t, translate, loadHindi, currentLang, type Lang } from "./t";
export const LANG_KEY = "fixlocal:lang";
export const HTML_LANG: Record<Lang, string> = { en: "en-IN", hi: "hi" };

export function storedLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === "hi" ? "hi" : "en";
  } catch {
    return "en";
  }
}

function storeLang(l: Lang) {
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* private mode: applies to this visit only */
  }
}

/** Set when someone picks a language while logged out; their next log-in saves it to the account. */
const PICKED_KEY = "fixlocal:lang-picked";
function pickedLoggedOut(): boolean {
  try {
    return localStorage.getItem(PICKED_KEY) === "1";
  } catch {
    return false;
  }
}
function setPickedLoggedOut(on: boolean) {
  try {
    if (on) localStorage.setItem(PICKED_KEY, "1");
    else localStorage.removeItem(PICKED_KEY);
  } catch {
    /* private mode */
  }
}

/** Call before the first render so a Hindi start-up shows Hindi straight away. */
export async function prepareLanguage() {
  if (storedLang() === "hi") await loadHindi().catch(() => undefined);
}

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (text: string) => string;
};
const I18nContext = createContext<Ctx>({
  lang: "en",
  setLang: () => undefined,
  t: (s) => s,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [lang, setLangState] = useState<Lang>(() =>
    storedLang() === "hi" && hindiReady() ? "hi" : "en",
  );
  setCurrentLang(lang);

  const apply = useCallback(async (l: Lang) => {
    if (l === "hi") {
      try {
        await loadHindi();
      } catch {
        return; // offline: stay in the current language
      }
    }
    storeLang(l);
    setLangState(l);
  }, []);

  // On log-in (or when a session is restored on load) the account's language wins, unless the person
  // picked a language on this device while logged out: then that choice is saved to the account.
  const adoptedFor = useRef<string | null>(null);
  const accountLang = user?.language;
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) {
      adoptedFor.current = null;
      return;
    }
    if (adoptedFor.current === userId) return;
    adoptedFor.current = userId;
    if (pickedLoggedOut()) {
      setPickedLoggedOut(false);
      if (accountLang !== lang) updateMe({ language: lang }).catch(() => undefined);
    } else if (accountLang && accountLang !== lang) void apply(accountLang);
  }, [userId, accountLang, lang, apply]);

  const setLang = useCallback(
    (l: Lang) => {
      void apply(l);
      if (userId) updateMe({ language: l }).catch(() => undefined); // keeps other devices in step
      else setPickedLoggedOut(true);
    },
    [apply, userId]
  );

  useEffect(() => {
    document.documentElement.lang = HTML_LANG[lang];
  }, [lang]);

  const tr = useCallback((text: string) => translate(lang, text), [lang]);
  const value = useMemo(() => ({ lang, setLang, t: tr }), [lang, setLang, tr]);
  return (
    <I18nContext.Provider value={value}>
      <Fragment key={lang}>{children}</Fragment>
    </I18nContext.Provider>
  );
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
      aria-label={
        next === "hi"
          ? "हिन्दी में देखें (View in Hindi)"
          : "View in English (अंग्रेज़ी में देखें)"
      }
    >
      <span lang={HTML_LANG[next]}>{next === "hi" ? "हिन्दी" : "English"}</span>
    </button>
  );
}
