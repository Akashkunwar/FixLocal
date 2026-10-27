import { useI18n } from "../lib/i18n";
import { Link } from "react-router-dom";
import { SITE } from "../lib/site";

export function SiteFooter({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  return (
    <footer className={`border-t border-slate-200 bg-white py-6 text-sm text-slate-500 ${className}`}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
        <p>© {new Date().getFullYear()} {SITE.name} · {t("Payments are simulated during the pilot")}</p>
        <nav aria-label="Legal" className="flex flex-wrap gap-4">
          <Link to="/terms" className="hover:text-slate-800">{t("Terms")}</Link>
          <Link to="/privacy" className="hover:text-slate-800">{t("Privacy")}</Link>
          <a href={`mailto:${SITE.supportEmail}`} className="hover:text-slate-800">{t("Contact")}</a>
        </nav>
      </div>
    </footer>
  );
}
