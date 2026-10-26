import { useState } from "react";
import { resendVerification } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { t } from "../lib/i18n";

/** Reminds unverified clients/pros that posting and bidding need a verified email. */
export function EmailVerifyBanner() {
  const { user } = useAuth();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  if (!user || user.role === "ADMIN" || user.emailVerified !== false) return null;
  const action = user.role === "HOMEOWNER" ? "post jobs" : "bid on jobs";

  async function resend() {
    setState("sending");
    try {
      await resendVerification();
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="status">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
        <span>
          {t("Verify your email (")}<strong>{user.email}</strong>{t(") to")}{" "}{action}.
        </span>
        {state === "sent" ? (
          <span>{t("Check your inbox for the link.")}</span>
        ) : (
          <button type="button" className="font-semibold underline" onClick={resend} disabled={state === "sending"}>
            {state === "sending" ? t("Sending…") : state === "error" ? t("Try again") : t("Resend link")}
          </button>
        )}
      </div>
    </div>
  );
}
