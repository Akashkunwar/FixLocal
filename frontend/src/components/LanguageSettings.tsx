import { Languages } from "lucide-react";
import { HTML_LANG, useI18n, type Lang } from "../lib/i18n";

const OPTIONS: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी (Hindi)" },
];

/** Settings card: pick English or Hindi (saved on this device). */
export function LanguageSettings() {
  const { lang, setLang, t } = useI18n();
  return (
    <section className="card space-y-3 p-5 sm:p-6">
      <fieldset>
        <legend className="flex items-center gap-2 font-semibold text-slate-900">
          <Languages className="h-5 w-5 text-brand-700" aria-hidden /> {t("Language")}
        </legend>
        <p className="mt-1 text-sm text-slate-500">
          {t("Choose the language for menus and the main pages. Job posts, bids and chat stay as people wrote them.")}
        </p>
        <div className="mt-3 flex flex-wrap gap-4">
          {OPTIONS.map((o) => (
            <label key={o.value} className="flex min-h-[44px] items-center gap-2 text-sm text-slate-800">
              <input type="radio" name="language" value={o.value} checked={lang === o.value} onChange={() => setLang(o.value)} />
              <span lang={HTML_LANG[o.value]}>{o.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}
