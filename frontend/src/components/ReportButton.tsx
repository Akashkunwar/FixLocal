import { FormEvent, useState } from "react";
import { Flag } from "lucide-react";
import { createReport } from "../api/client";
import { useToast } from "./Toast";
import { t } from "../lib/i18n";

import { errorText } from "../lib/apiErrors";
type Props = {
  targetType: "job" | "user" | "message";
  targetId?: string | null;
  label?: string;
};

/** Lets any user flag a job, user or message for admin review. */
export function ReportButton({ targetType, targetId, label = "Report" }: Props) {
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!targetId) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!targetId || !reason.trim()) return;
    setBusy(true);
    try {
      await createReport(targetType, targetId, reason.trim());
      success(t("Report sent. An admin will review it."));
      setOpen(false);
      setReason("");
    } catch (err) {
      error(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn-ghost btn-sm text-slate-500" onClick={() => setOpen(true)}>
        <Flag className="h-4 w-4" /> {label}
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="card space-y-2 p-4">
      <label className="label" htmlFor={`report-${targetId}`}>
        {t("What's wrong?")}
      </label>
      <textarea
        id={`report-${targetId}`}
        className="input"
        required
        maxLength={2000}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t("Describe the problem so an admin can act on it.")}
      />
      <div className="flex gap-2">
        <button type="submit" className="btn-primary btn-sm" disabled={busy}>
          {busy ? t("Sending…") : t("Send report")}
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}
