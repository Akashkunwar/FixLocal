import { t } from "../lib/i18n";

/**
 * First focusable element on every page: jumps keyboard and screen-reader users past the header to
 * the page's <main> (or its first heading when a page has no <main>).
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-brand-800 focus:shadow-lg focus:ring-2 focus:ring-brand-500"
      onClick={(e) => {
        const target = document.querySelector<HTMLElement>("main") ?? document.querySelector<HTMLElement>("h1");
        if (!target) return;
        e.preventDefault();
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus();
        target.scrollIntoView({ block: "start" });
      }}
    >
      {t("Skip to content")}
    </a>
  );
}
