import { useState } from "react";
import { Link } from "react-router-dom";
import { acceptTerms } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/** Shown to accounts that haven't accepted the current Terms / Privacy Policy (e.g. created before they existed). */
export function TermsBanner() {
  const { user, refreshUser } = useAuth();
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  if (!user || user.termsAccepted !== false) return null;

  async function accept() {
    setState("saving");
    try {
      await acceptTerms();
      await refreshUser();
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="border-b border-brand-200 bg-brand-50 px-4 py-2 text-sm text-brand-900" role="region" aria-label="Updated terms">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
        <span>
          We’ve published our <Link to="/terms">Terms of Service</Link> and <Link to="/privacy">Privacy Policy</Link>.
          Please review and accept them to keep using FixLocal.
        </span>
        <button type="button" className="btn-primary btn-sm" onClick={accept} disabled={state === "saving"}>
          {state === "saving" ? "Saving…" : state === "error" ? "Try again" : "I accept"}
        </button>
      </div>
    </div>
  );
}
