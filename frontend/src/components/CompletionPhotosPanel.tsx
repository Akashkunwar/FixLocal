import { useEffect, useState } from "react";
import {
  mediaUrl,
  publishCaseStudyFromJob,
  removeCompletionPhoto,
  uploadCompletionPhotos,
  type Job,
} from "../api/jobs";
import { useToast } from "./Toast";
import { proPath } from "../lib/paths";
import clsx from "clsx";

export function CompletionPhotosPanel({
  job,
  canEdit,
  onChanged,
  /** When true, show one-click publish to professional portfolio */
  canPublishCaseStudy = false,
}: {
  job: Job;
  canEdit: boolean;
  onChanged: () => void;
  canPublishCaseStudy?: boolean;
}) {
  const { success, error } = useToast();
  const [beforeFiles, setBeforeFiles] = useState<File[]>([]);
  const [afterFiles, setAfterFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishTitle, setPublishTitle] = useState(job.title || "");
  const [publishNotes, setPublishNotes] = useState("");
  const [showPublish, setShowPublish] = useState(false);
  const [pickBefore, setPickBefore] = useState<string | null>(null);
  const [pickAfter, setPickAfter] = useState<string | null>(null);

  const before = job.beforePhotoUrls || [];
  const after = job.afterPhotoUrls || [];
  const hasPhotos = before.length > 0 || after.length > 0;
  const showEmpty = !hasPhotos && !canEdit;
  const multiPair = before.length > 1 || after.length > 1;
  const caseDraftKey = `fixlocal_case_study_draft_${job.id}`;

  useEffect(() => {
    setPickBefore((prev) => (prev && before.includes(prev) ? prev : before[0] || null));
    setPickAfter((prev) => (prev && after.includes(prev) ? prev : after[0] || null));
  }, [before.join("|"), after.join("|")]);

  // Soft case-study draft (title/notes) — local only until publish
  useEffect(() => {
    try {
      const raw = localStorage.getItem(caseDraftKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.title != null) setPublishTitle(String(parsed.title));
      if (parsed?.notes != null) setPublishNotes(String(parsed.notes));
      if (parsed?.open) setShowPublish(true);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseDraftKey]);

  useEffect(() => {
    try {
      localStorage.setItem(
        caseDraftKey,
        JSON.stringify({
          title: publishTitle,
          notes: publishNotes,
          open: showPublish,
          updatedAt: new Date().toISOString(),
        })
      );
    } catch {
      /* quota */
    }
  }, [caseDraftKey, publishTitle, publishNotes, showPublish]);

  if (showEmpty) return null;

  async function onUpload() {
    if (!beforeFiles.length && !afterFiles.length) {
      error("Choose at least one before or after photo");
      return;
    }
    setBusy(true);
    try {
      await uploadCompletionPhotos(job.id, { before: beforeFiles, after: afterFiles });
      success("Completion photos uploaded");
      setBeforeFiles([]);
      setAfterFiles([]);
      onChanged();
    } catch (e: any) {
      error(e.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(url: string, kind: "before" | "after") {
    try {
      await removeCompletionPhoto(job.id, { url, kind });
      success("Photo removed");
      onChanged();
    } catch (e: any) {
      error(e.message);
    }
  }

  async function onPublish() {
    if (!hasPhotos) {
      error("Add before/after photos first");
      return;
    }
    setPublishBusy(true);
    try {
      const r = await publishCaseStudyFromJob(job.id, {
        title: publishTitle.trim() || job.title,
        notes: publishNotes.trim() || undefined,
        beforeUrl: pickBefore || before[0],
        afterUrl: pickAfter || after[0],
      });
      success(r.message || "Published to portfolio");
      setShowPublish(false);
      try {
        localStorage.removeItem(caseDraftKey);
      } catch {
        /* ignore */
      }
    } catch (e: any) {
      error(e.message || "Publish failed");
    } finally {
      setPublishBusy(false);
    }
  }

  function Gallery({
    title,
    urls,
    kind,
  }: {
    title: string;
    urls: string[];
    kind: "before" | "after";
  }) {
    if (urls.length === 0 && !canEdit) return null;
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
          {title}
        </p>
        {urls.length === 0 ? (
          <p className="text-xs text-slate-400 mb-2">None yet</p>
        ) : (
          <ul className="flex flex-wrap gap-2 mb-2">
            {urls.map((u) => (
              <li key={u} className="relative group">
                <a href={mediaUrl(u)} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={mediaUrl(u)}
                    alt={title}
                    className="h-24 w-24 rounded-xl object-cover ring-1 ring-slate-200"
                  />
                </a>
                {canEdit && job.status !== "disputed" && (
                  <button
                    type="button"
                    className="absolute -right-1 -top-1 rounded-full bg-slate-900/80 px-1.5 text-[10px] text-white opacity-0 group-hover:opacity-100"
                    onClick={() => onRemove(u, kind)}
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  function PairPicker({
    label,
    urls,
    selected,
    onSelect,
  }: {
    label: string;
    urls: string[];
    selected: string | null;
    onSelect: (u: string) => void;
  }) {
    if (urls.length === 0) {
      return (
        <div>
          <p className="text-xs font-semibold text-slate-500 mb-1">{label}</p>
          <p className="text-xs text-slate-400">None uploaded</p>
        </div>
      );
    }
    return (
      <div>
        <p className="text-xs font-semibold text-slate-500 mb-1">
          {label}
          {urls.length > 1 ? " — pick one" : ""}
        </p>
        <ul className="flex flex-wrap gap-2" role="listbox" aria-label={label}>
          {urls.map((u) => {
            const active = selected === u;
            return (
              <li key={u}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={clsx(
                    "block overflow-hidden rounded-xl ring-2 transition",
                    active ? "ring-sky-500" : "ring-slate-200 hover:ring-slate-300"
                  )}
                  onClick={() => onSelect(u)}
                >
                  <img
                    src={mediaUrl(u)}
                    alt=""
                    className="h-16 w-16 object-cover"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <section className="card p-5 sm:p-6 space-y-4">
      <div>
        <h2 className="font-semibold text-lg text-slate-900">Before &amp; after</h2>
        <p className="text-sm text-slate-500">
          Completion gallery for this job — upload when finishing work or anytime after.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Gallery title="Before" urls={before} kind="before" />
        <Gallery title="After" urls={after} kind="after" />
      </div>
      {canEdit && (
        <div className="space-y-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Before photos</label>
              <input
                className="input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                aria-label="Before photos"
                onChange={(e) => setBeforeFiles(Array.from(e.target.files || []).slice(0, 4))}
              />
            </div>
            <div>
              <label className="label">After photos</label>
              <input
                className="input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                aria-label="After photos"
                onChange={(e) => setAfterFiles(Array.from(e.target.files || []).slice(0, 4))}
              />
            </div>
          </div>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={busy}
            onClick={onUpload}
          >
            {busy ? "Uploading…" : "Upload photos"}
          </button>
        </div>
      )}

      {canPublishCaseStudy && hasPhotos && job.status === "completed" && !job.photoConsent && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
          To show these photos in your portfolio, ask the client to allow it on their job page.
        </p>
      )}
      {job.status === "disputed" && canEdit && (
        <p className="text-xs text-amber-800">Photos can be added but not removed while the job is in dispute.</p>
      )}
      {canPublishCaseStudy && hasPhotos && job.status === "completed" && job.photoConsent && (
        <div className="space-y-3 rounded-xl bg-sky-50 p-4 ring-1 ring-sky-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-sky-950">Portfolio case study</p>
              <p className="text-[11px] text-sky-800/80">Draft autosaves in this browser until you publish.</p>
              <p className="text-xs text-sky-800/80">
                One-click publish before/after to your professional portfolio.
                {multiPair ? " Pick which pair when several exist." : ""}
              </p>
            </div>
            <button
              type="button"
              className={showPublish ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
              onClick={() => setShowPublish((v) => !v)}
            >
              {showPublish ? "Close" : "Publish to portfolio"}
            </button>
          </div>
          {showPublish && (
            <div className="space-y-3">
              <div>
                <label className="label" htmlFor="cs-title">
                  Case study title
                </label>
                <input
                  id="cs-title"
                  className="input"
                  value={publishTitle}
                  onChange={(e) => setPublishTitle(e.target.value)}
                  placeholder="e.g. Kitchen leak before/after"
                />
              </div>
              <div>
                <label className="label" htmlFor="cs-notes">
                  Notes (optional)
                </label>
                <textarea
                  id="cs-notes"
                  className="input"
                  rows={2}
                  value={publishNotes}
                  onChange={(e) => setPublishNotes(e.target.value)}
                  placeholder="What you fixed / materials / outcome"
                />
              </div>
              {(multiPair || before.length > 0 || after.length > 0) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <PairPicker
                    label="Before photo"
                    urls={before}
                    selected={pickBefore}
                    onSelect={setPickBefore}
                  />
                  <PairPicker
                    label="After photo"
                    urls={after}
                    selected={pickAfter}
                    onSelect={setPickAfter}
                  />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={publishBusy}
                  onClick={onPublish}
                >
                  {publishBusy ? "Publishing…" : "Publish case study"}
                </button>
                <a
                  href={proPath("profile")}
                  className="btn-ghost btn-sm no-underline"
                >
                  Open portfolio
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
