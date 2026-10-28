import { useState } from "react";
import { Download, X } from "lucide-react";
import { dismissedRecently, isIosSafari, isStandalone, promptInstall, rememberDismissal, useInstallPrompt } from "../lib/install";

import { t } from "../lib/i18n";
/** Offers "Install FixLocal" where the browser allows it, and the Add-to-Home-Screen steps on iPhone. */
export function InstallAppBanner() {
  const { canPrompt, installed } = useInstallPrompt();
  const [hidden, setHidden] = useState(() => dismissedRecently());
  const ios = typeof navigator !== "undefined" && isIosSafari(navigator.userAgent) && !isStandalone();
  if (hidden || installed || (!canPrompt && !ios)) return null;

  const dismiss = () => {
    rememberDismissal();
    setHidden(true);
  };

  return (
    <div className="border-b border-brand-100 bg-brand-50 px-4 py-2 text-sm text-brand-900" role="region" aria-label={t("Install app")}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
        <Download className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          {canPrompt
            ? t("Install FixLocal for one-tap access and job updates, even on a patchy connection.")
            : t("Install FixLocal: tap the Share button in Safari, then “Add to Home Screen”.")}
        </span>
        {canPrompt && (
          <button type="button" className="btn-primary btn-sm" onClick={() => void promptInstall()}>
            
            {t("Install app")}
          </button>
        )}
        <button type="button" className="rounded-lg p-1.5 hover:bg-brand-100" onClick={dismiss} aria-label={t("Not now, hide install tip")}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
