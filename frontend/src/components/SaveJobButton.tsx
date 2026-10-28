import { useState } from "react";
import { Heart } from "lucide-react";
import { addFavorite, listFavorites, removeFavorite } from "../api/extras";
import { useQuery } from "../lib/useQuery";
import { errorText } from "../lib/apiErrors";
import { t } from "../lib/i18n";
import { useToast } from "./Toast";

/**
 * Save / unsave a job. Loads whether the job is already saved, so the heart shows the real state
 * on every visit, and the same button removes it again (fe-logic HIGH 8).
 */
export function SaveJobButton({ jobId }: { jobId: string }) {
  const { success, error } = useToast();
  const q = useQuery(`fav-jobs:${jobId}`, () =>
    listFavorites("job").then((r) => r.favorites.some((f) => f.targetId === jobId))
  );
  const [busy, setBusy] = useState(false);
  const saved = !!q.data;

  async function toggle() {
    if (busy || q.loading) return;
    setBusy(true);
    try {
      if (saved) {
        await removeFavorite("job", jobId);
        q.setData(false);
        success(t("Removed from saved"));
      } else {
        await addFavorite("job", jobId);
        q.setData(true);
        success(t("Saved job"));
      }
    } catch (e) {
      error(errorText(e, "Couldn't update saved jobs"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="btn-secondary btn-sm"
      onClick={toggle}
      disabled={busy || q.loading}
      aria-pressed={saved}
      aria-label={saved ? t("Remove from saved jobs") : t("Save job")}
    >
      <Heart className={`h-4 w-4 ${saved ? "fill-rose-500 text-rose-500" : ""}`} aria-hidden="true" />
      {saved ? t("Saved") : t("Save")}
    </button>
  );
}
