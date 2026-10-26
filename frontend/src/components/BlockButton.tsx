import { useState } from "react";
import { Ban } from "lucide-react";
import { blockUser } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "./Toast";
import { t } from "../lib/i18n";

type Props = { userId?: string | null; name?: string | null; className?: string; onBlocked?: () => void };

/** Two-step "Block" control. Blocking stops bids, invites and new messages in both directions. */
export function BlockButton({ userId, name, className = "", onBlocked }: Props) {
  const { user } = useAuth();
  const { success, error } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (!userId || !user || user.id === userId || user.role === "ADMIN") return null;
  const who = name || "this person";

  async function block() {
    setBusy(true);
    try {
      await blockUser(userId!);
      setDone(true);
      setConfirming(false);
      success(`${who} is blocked. You can undo this in Settings.`);
      onBlocked?.();
    } catch (err) {
      error((err as Error).message || "Couldn't block");
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className="text-sm text-slate-500">{t("Blocked · manage in Settings")}</p>;
  if (!confirming) {
    return (
      <button type="button" className={`btn-ghost btn-sm text-slate-500 ${className}`} onClick={() => setConfirming(true)}>
        <Ban className="h-4 w-4" aria-hidden /> {t("Block")}
      </button>
    );
  }
  return (
    <div className="card space-y-2 p-4" role="group" aria-label={`Block ${who}`}>
      <p className="text-sm text-slate-700">
        {t("Block")}{" "}{who}{t("? They won't be able to bid on your jobs, invite you or message you, and you won't be able to contact them. Jobs already in progress are not affected.")}
      </p>
      <div className="flex gap-2">
        <button type="button" className="btn-danger btn-sm" onClick={block} disabled={busy}>
          {busy ? t("Blocking…") : t("Block")}
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirming(false)}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}
