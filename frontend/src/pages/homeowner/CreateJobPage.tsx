import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shell } from "../../components/Shell";
import { createJob } from "../../api/jobs";
import { CATEGORIES, categoryGroups, categoryLabel } from "../../lib/format";
import { clientPath, SITE_TYPES, siteTypeLabel, type SiteType } from "../../lib/paths";
import { templatesForGroup, type JobTemplate } from "../../lib/jobTemplates";
import { compressImageFiles } from "../../lib/compressImage";
import { useToast } from "../../components/Toast";
import clsx from "clsx";
import { LazyMapPinPicker, preloadMapPicker } from "../../components/LazyMapPinPicker";
import { BLR_CENTER } from "../../lib/geo";
import {
  CADENCE_OPTIONS,
  cadenceLabel,
  normalizeCadence,
  type JobCadence,
} from "../../lib/jobCadence";
import {
  clearRepeatBanner,
  JOB_DRAFT_KEY,
  peekRepeatBanner,
} from "../../lib/repeatJob";
import {
  draftFromNamedTemplate,
  filterNamedJobTemplates,
  mergeNamedJobTemplates,
  namedTemplateSpecialtyOptions,
  type NamedJobTemplate,
} from "../../lib/namedJobTemplates";
import { useAuth } from "../../auth/AuthContext";
import { t } from "../../lib/i18n";

const DRAFT_KEY = JOB_DRAFT_KEY;
const STEPS = ["Basics", "Budget & location", "Photos & review"] as const;

type Draft = {
  title: string;
  description: string;
  leadGroup: string;
  category: string;
  siteType: SiteType | "";
  cadence: JobCadence;
  cadenceNote: string;
  maxBids: string;
  budgetMin: string;
  budgetMax: string;
  address: string;
  city: string;
  area: string;
  pincode: string;
  preferredStart: string;
  /** "true" when it's needed within 24 hours (kept as a string so the draft stays FormData-friendly). */
  urgent: string;
  lat: string;
  lng: string;
};

const groups = categoryGroups();
const defaultGroup = groups[0]?.[0] || "Home repair & maintenance";
const defaultCat =
  CATEGORIES.find((c) => c.group === defaultGroup)?.value || "plumbing";

const emptyDraft: Draft = {
  title: "",
  description: "",
  leadGroup: defaultGroup,
  category: defaultCat,
  siteType: "residential",
  cadence: "one_time",
  cadenceNote: "",
  maxBids: "5",
  budgetMin: "",
  budgetMax: "",
  address: "",
  city: "Bengaluru",
  area: "",
  pincode: "",
  preferredStart: "",
  urgent: "",
  lat: String(BLR_CENTER.lat),
  lng: String(BLR_CENTER.lng),
};

export function CreateJobPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { success, error } = useToast();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  // Fetch the map chunk while the user is still on step one, so step two's map appears instantly.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    idle(() => preloadMapPicker());
  }, []);
  const [files, setFiles] = useState<File[]>([]);
  const [repeatBanner, setRepeatBanner] = useState(() => peekRepeatBanner());
  const namedLibrary = useMemo(
    () => mergeNamedJobTemplates(user?.namedJobTemplates),
    [user?.namedJobTemplates]
  );
  const [namedQuery, setNamedQuery] = useState("");
  const [namedSpecialty, setNamedSpecialty] = useState<string>("all");
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = { ...emptyDraft, ...JSON.parse(raw) };
        const cat = CATEGORIES.find((c) => c.value === parsed.category);
        if (cat && !parsed.leadGroup) parsed.leadGroup = cat.group;
        parsed.cadence = normalizeCadence(parsed.cadence);
        if (parsed.cadenceNote == null) parsed.cadenceNote = "";
        return parsed;
      }
    } catch { /* ignore */ }
    return emptyDraft;
  });

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft]);

  const specialtyOptions = useMemo(
    () => CATEGORIES.filter((c) => c.group === draft.leadGroup),
    [draft.leadGroup]
  );

  const groupTemplates = useMemo(
    () => templatesForGroup(draft.leadGroup),
    [draft.leadGroup]
  );

  const namedSpecialtyOptions = useMemo(
    () => namedTemplateSpecialtyOptions(namedLibrary),
    [namedLibrary]
  );

  const filteredNamedLibrary = useMemo(
    () =>
      filterNamedJobTemplates(namedLibrary, {
        q: namedQuery,
        category: namedSpecialty,
      }),
    [namedLibrary, namedQuery, namedSpecialty]
  );

  const previews = useMemo(
    () => files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })),
    [files]
  );

  useEffect(() => {
    return () => previews.forEach((p) => URL.revokeObjectURL(p.url));
  }, [previews]);

  function patch(partial: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...partial }));
  }

  function selectLeadGroup(group: string) {
    const first = CATEGORIES.find((c) => c.group === group);
    const templates = templatesForGroup(group);
    const soft = templates[0];
    const titleEmpty = !draft.title.trim();
    const descEmpty = !draft.description.trim();
    patch({
      leadGroup: group,
      category: soft?.category || first?.value || draft.category,
      siteType:
        soft?.siteType ||
        (group === "Office & facilities"
          ? "office"
          : draft.siteType || "residential"),
      ...(titleEmpty && soft ? { title: soft.title } : {}),
      ...(descEmpty && soft ? { description: soft.description } : {}),
    });
  }

  function applyTemplate(tpl: JobTemplate) {
    patch({
      title: tpl.title,
      description: tpl.description,
      category: tpl.category,
      siteType: tpl.siteType || draft.siteType || "residential",
      leadGroup:
        CATEGORIES.find((c) => c.value === tpl.category)?.group || draft.leadGroup,
    });
  }

  function applyNamedTemplate(tpl: NamedJobTemplate) {
    const d = draftFromNamedTemplate(tpl);
    patch({
      ...d,
      siteType: d.siteType || draft.siteType || "residential",
      maxBids: d.maxBids || draft.maxBids || "5",
    });
    success(`Applied library template “${tpl.name}”`);
  }

  function canNext() {
    if (step === 0) {
      return (
        draft.title.trim().length >= 3 &&
        draft.description.trim().length >= 10 &&
        !!draft.category
      );
    }
    if (step === 1) {
      if (draft.budgetMin && draft.budgetMax && Number(draft.budgetMin) > Number(draft.budgetMax)) {
        return false;
      }
      return true;
    }
    return true;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (step < STEPS.length - 1) {
      if (!canNext()) {
        error(step === 0 ? "Add a clear title, description, and specialty" : "Check budget range");
        return;
      }
      setStep((s) => s + 1);
      return;
    }

    const fd = new FormData();
    Object.entries(draft).forEach(([k, v]) => {
      if (k === "leadGroup") return;
      if (v) fd.append(k, v);
    });
    files.slice(0, 5).forEach((f) => fd.append("photos", f));

    setBusy(true);
    try {
      const r = await createJob(fd);
      localStorage.removeItem(DRAFT_KEY);
      clearRepeatBanner();
      setRepeatBanner(null);
      success("Job posted!");
      navigate(clientPath(`jobs/${r.job.id}`));
    } catch (err) {
      error((err as Error).message || "Could not create job");
    } finally {
      setBusy(false);
    }
  }

  function clearDraft() {
    setDraft(emptyDraft);
    setFiles([]);
    setStep(0);
    localStorage.removeItem(DRAFT_KEY);
    clearRepeatBanner();
    setRepeatBanner(null);
    success("Draft cleared");
  }

  function dismissRepeatBanner() {
    clearRepeatBanner();
    setRepeatBanner(null);
  }

  return (
    <Shell
      title={t("Post a job")}
      subtitle={t("Guided wizard — draft autosaves in this browser")}
      actions={
        <button type="button" className="btn-ghost btn-sm" onClick={clearDraft}>
          {t("Clear draft")}
        </button>
      }
    >
      <ol className="mb-6 flex flex-wrap gap-2">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={clsx(
              "rounded-full px-3 py-1 text-xs font-semibold",
              i === step
                ? "bg-brand-700 text-white"
                : i < step
                  ? "bg-brand-100 text-brand-800"
                  : "bg-slate-100 text-slate-600"
            )}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {repeatBanner && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2 rounded-xl bg-violet-50 px-4 py-3 text-sm text-violet-950 ring-1 ring-violet-100">
          <p>
            <span className="font-semibold">{t("Prefilling from completed job")}</span>
            {repeatBanner.title ? (
              <>
                : <span className="opacity-90">{repeatBanner.title}</span>
              </>
            ) : null}
            {t(". Cadence, specialty, and site are copied — edit anything before posting.")}
          </p>
          <button
            type="button"
            className="btn-ghost btn-sm shrink-0"
            onClick={dismissRepeatBanner}
          >
            {t("Dismiss")}
          </button>
        </div>
      )}

      <form onSubmit={onSubmit} className="card max-w-2xl space-y-4 p-6">
        {step === 0 && (
          <>
            <div>
              <label className="label" htmlFor="title">{t("Title")}</label>
              <input
                id="title"
                className="input"
                required
                placeholder={t("e.g. Kitchen sink leak")}
                value={draft.title}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="description">{t("Description")}</label>
              <textarea
                id="description"
                className="input min-h-[120px]"
                required
                placeholder={t("What's wrong? Any access notes?")}
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </div>

            <div>
              <p className="label">{t("Work type")}</p>
              <p className="mb-2 text-xs text-slate-500">{t("Pick a lead group, then a specialty.")}</p>
              <div className="flex flex-wrap gap-2">
                {groups.map(([group]) => (
                  <button
                    key={group}
                    type="button"
                    className={clsx(
                      "rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition",
                      draft.leadGroup === group
                        ? "bg-brand-700 text-white ring-brand-700"
                        : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                    )}
                    onClick={() => selectLeadGroup(group)}
                  >
                    {t(group)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="label">{t("Specialty")}</p>
              <div className="flex flex-wrap gap-2">
                {specialtyOptions.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className={clsx(
                      "rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition",
                      draft.category === c.value
                        ? "bg-brand-50 text-brand-900 ring-brand-300"
                        : "bg-slate-50 text-slate-600 ring-slate-200 hover:bg-white"
                    )}
                    onClick={() => patch({ category: c.value })}
                  >
                    {c.emoji} {t(c.label)}
                  </button>
                ))}
              </div>
            </div>

            {groupTemplates.length > 0 && (
              <div>
                <p className="label">{t("Quick templates")}</p>
                <p className="mb-2 text-xs text-slate-500">
                  {t("Prefills title, description, and specialty for this lead group.")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {groupTemplates.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      className="rounded-full bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-white"
                      onClick={() => applyTemplate(tpl)}
                    >
                      {t(tpl.label)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {namedLibrary.length > 0 && (
              <div>
                <p className="label">{t("Your job templates")}</p>
                <p className="mb-2 text-xs text-slate-500">
                  {t("Named library from past completed jobs — search or filter by specialty.")}
                </p>
                <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    className="input sm:max-w-xs"
                    type="search"
                    placeholder={t("Search templates…")}
                    value={namedQuery}
                    onChange={(e) => setNamedQuery(e.target.value)}
                    aria-label={t("Search named job templates")}
                  />
                  <div
                    className="flex flex-wrap gap-1.5"
                    role="group"
                    aria-label={t("Filter templates by specialty")}
                  >
                    <button
                      type="button"
                      className={
                        namedSpecialty === "all"
                          ? "btn-primary btn-sm"
                          : "btn-secondary btn-sm"
                      }
                      aria-pressed={namedSpecialty === "all"}
                      onClick={() => setNamedSpecialty("all")}
                    >
                      {t("All")}
                    </button>
                    {namedSpecialtyOptions.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={
                          namedSpecialty === c
                            ? "btn-primary btn-sm"
                            : "btn-secondary btn-sm"
                        }
                        aria-pressed={namedSpecialty === c}
                        onClick={() => setNamedSpecialty(c)}
                      >
                        {categoryLabel(c)}
                      </button>
                    ))}
                  </div>
                </div>
                {filteredNamedLibrary.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    {t("No templates match this search / specialty filter.")}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {filteredNamedLibrary.map((tmpl) => (
                      <button
                        key={tmpl.id}
                        type="button"
                        className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-900 ring-1 ring-violet-200 hover:bg-white"
                        title={`${tmpl.title} · ${categoryLabel(tmpl.category)}`}
                        onClick={() => applyNamedTemplate(tmpl)}
                      >
                        {tmpl.name}
                        <span className="ml-1 text-violet-700">
                          · {categoryLabel(tmpl.category)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              <p className="label">{t("Site")}</p>
              <div className="flex flex-wrap gap-2">
                {SITE_TYPES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className={clsx(
                      "rounded-xl px-3 py-2 text-left text-xs ring-1 transition",
                      draft.siteType === s.value
                        ? "bg-brand-50 text-brand-900 ring-brand-300"
                        : "bg-white text-slate-600 ring-slate-200"
                    )}
                    onClick={() => patch({ siteType: s.value })}
                  >
                    <span className="block font-semibold">{t(s.label)}</span>
                    <span className="text-slate-500">{t(s.hint)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="maxBids">{t("Max bids")}</label>
              <input
                id="maxBids"
                className="input max-w-32"
                type="number"
                min={1}
                max={20}
                value={draft.maxBids}
                onChange={(e) => patch({ maxBids: e.target.value })}
              />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="budgetMin">{t("Budget min (₹)")}</label>
                <input
                  id="budgetMin"
                  className="input"
                  type="number"
                  min={0}
                  value={draft.budgetMin}
                  onChange={(e) => patch({ budgetMin: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="budgetMax">{t("Budget max (₹)")}</label>
                <input
                  id="budgetMax"
                  className="input"
                  type="number"
                  min={0}
                  value={draft.budgetMax}
                  onChange={(e) => patch({ budgetMax: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="address">{t("Address")}</label>
                <input
                  id="address"
                  className="input"
                  value={draft.address}
                  onChange={(e) => patch({ address: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="pincode">{t("Pincode")}</label>
                <input
                  id="pincode"
                  className="input"
                  value={draft.pincode}
                  onChange={(e) => patch({ pincode: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="city">{t("City")}</label>
                <input
                  id="city"
                  className="input"
                  placeholder={t("Bengaluru")}
                  value={draft.city}
                  onChange={(e) => patch({ city: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="area">{t("Neighborhood")}</label>
                <input
                  id="area"
                  className="input"
                  placeholder={t("Indiranagar")}
                  value={draft.area}
                  onChange={(e) => patch({ area: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="preferredStart">{t("Preferred start")}</label>
                <input
                  id="preferredStart"
                  className="input"
                  type="datetime-local"
                  value={draft.preferredStart}
                  onChange={(e) => patch({ preferredStart: e.target.value })}
                />
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-slate-800">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 accent-amber-600"
                checked={draft.urgent === "true"}
                onChange={(e) => patch({ urgent: e.target.checked ? "true" : "" })}
              />
              <span>
                <span className="font-semibold">{t("Urgent: needed within 24 hours")}</span>
                <span className="block text-xs text-slate-600">
                  {t("Matching professionals are alerted straight away and your job is marked urgent for two days.")}
                </span>
              </span>
            </label>

            <div>
              <p className="label">{t("Job cadence")}</p>
              <p className="mb-2 text-xs text-slate-500">
                {t("Soft preference only — one-time, weekly, monthly, or AMC interest. Pros see this on the job; no auto-recurring engine yet.")}
              </p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("Job cadence")}>
                {CADENCE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={clsx(
                      "rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition",
                      draft.cadence === opt.value
                        ? "bg-brand-700 text-white ring-brand-700"
                        : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                    )}
                    aria-pressed={draft.cadence === opt.value}
                    onClick={() => patch({ cadence: opt.value })}
                    title={t(opt.hint)}
                  >
                    {t(opt.label)}
                  </button>
                ))}
              </div>
              {draft.cadence !== "one_time" && (
                <div className="mt-3">
                  <label className="label" htmlFor="cadenceNote">
                    {t("Cadence note (optional)")}
                  </label>
                  <input
                    id="cadenceNote"
                    className="input"
                    maxLength={500}
                    placeholder={
                      draft.cadence === "amc"
                        ? t("e.g. Annual AC service, prefer evenings")
                        : t("e.g. Every Saturday morning")
                    }
                    value={draft.cadenceNote}
                    onChange={(e) => patch({ cadenceNote: e.target.value })}
                  />
                </div>
              )}
            </div>

            <div>
              <p className="label">{t("Pin on map")}</p>
              <LazyMapPinPicker
                lat={draft.lat ? Number(draft.lat) : null}
                lng={draft.lng ? Number(draft.lng) : null}
                onChange={({ lat, lng }) =>
                  patch({ lat: String(lat), lng: String(lng) })
                }
              />
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="lat">{t("Latitude")}</label>
                  <input
                    id="lat"
                    className="input font-mono text-sm"
                    value={draft.lat}
                    onChange={(e) => patch({ lat: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="lng">{t("Longitude")}</label>
                  <input
                    id="lng"
                    className="input font-mono text-sm"
                    value={draft.lng}
                    onChange={(e) => patch({ lng: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <label className="label" htmlFor="photos">{t("Photos (up to 5)")}</label>
              <input
                id="photos"
                className="input"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                multiple
                onChange={async (e) => {
                  const input = e.currentTarget;
                  const picked = Array.from(input.files || []).slice(0, 5);
                  try {
                    setFiles(await compressImageFiles(picked));
                  } catch (err) {
                    input.value = "";
                    error((err as Error).message);
                  }
                }}
              />
              {previews.length > 0 && (
                <ul className="mt-3 grid grid-cols-3 gap-2">
                  {previews.map((p) => (
                    <li key={p.url} className="aspect-4/3 overflow-hidden rounded-lg bg-slate-100">
                      <img src={p.url} alt={p.name} className="h-full w-full object-cover" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700 space-y-1 ring-1 ring-slate-200">
              <p className="font-semibold text-slate-900">{t("Review")}</p>
              <p><span className="text-slate-500">{t("Title:")}</span> {draft.title || "—"}</p>
              <p><span className="text-slate-500">{t("Category:")}</span> {categoryLabel(draft.category)}</p>
              <p><span className="text-slate-500">{t("Site:")}</span> {siteTypeLabel(draft.siteType) || "—"}</p>
              <p>
                <span className="text-slate-500">{t("Cadence:")}</span>{" "}
                {cadenceLabel(draft.cadence)}
                {draft.cadenceNote.trim() ? ` — ${draft.cadenceNote.trim()}` : ""}
              </p>
              <p><span className="text-slate-500">{t("Budget:")}</span> ₹{draft.budgetMin || "?"} – ₹{draft.budgetMax || "?"}</p>
              {draft.urgent === "true" && <p className="font-semibold text-amber-800">{t("Urgent: needed within 24 hours")}</p>}
              <p><span className="text-slate-500">{t("Location:")}</span> {[draft.city, draft.area, draft.address].filter(Boolean).join(" · ") || "—"}</p>
              {draft.lat && draft.lng && (
                <p><span className="text-slate-500">{t("Coords:")}</span> {draft.lat}, {draft.lng}</p>
              )}
              <p className="line-clamp-3"><span className="text-slate-500">{t("Details:")}</span> {draft.description}</p>
            </div>
          </>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          {step > 0 && (
            <button type="button" className="btn-secondary" onClick={() => setStep((s) => s - 1)}>
              {t("Back")}
            </button>
          )}
          <button type="submit" className="btn-primary" disabled={busy || !canNext()}>
            {busy ? t("Posting…") : step < STEPS.length - 1 ? t("Continue") : t("Post job")}
          </button>
          <button type="button" className="btn-ghost" onClick={() => navigate(-1)}>{t("Cancel")}</button>
        </div>
      </form>
    </Shell>
  );
}
