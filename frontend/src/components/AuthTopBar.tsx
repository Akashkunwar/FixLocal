import clsx from "clsx";
import { Link } from "react-router-dom";
import { Wrench } from "lucide-react";
import { LanguageToggle, t } from "../lib/i18n";

/**
 * Top row of the sign-in, sign-up and account pages: the logo links home (also on phones, where the
 * login page hides its brand panel) and the language switch is reachable before logging in.
 */
export function AuthTopBar({ logoClassName }: { logoClassName?: string }) {
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <Link
        to="/"
        className={clsx("flex items-center gap-2 font-display text-lg font-semibold text-brand-800 no-underline", logoClassName)}
        aria-label={t("FixLocal home")}
      >
        <Wrench className="h-5 w-5" aria-hidden /> FixLocal
      </Link>
      <span className="ml-auto">
        <LanguageToggle />
      </span>
    </div>
  );
}
