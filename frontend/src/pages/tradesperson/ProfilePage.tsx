import { FormEvent, useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import {
  getProfile,
  updateProfile,
  uploadGallery,
  uploadLicenseDoc,
  removeGalleryImage,
  mediaUrl,
  type TradespersonProfile,
} from "../../api/jobs";
import { Spinner } from "../../components/ui/Spinner";
import { Badge } from "../../components/ui/Badge";
import { StarRating } from "../../components/ui/StarRating";
import { useToast } from "../../components/Toast";
import { ImagePlus, Trash2 } from "lucide-react";
import { CATEGORIES } from "../../lib/format";
import {
  SERVICE_AREA_OPTIONS,
  joinServiceAreas,
  parseServiceAreas,
} from "../../lib/serviceAreas";
import {
  softRatePackages,
  formatCustomPackage,
  normalizeCustomRatePackages,
  newCustomPackageId,
  type CustomRatePackage,
} from "../../lib/ratePackages";
import {
  normalizeCaseStudies,
  newCaseStudyId,
  type CaseStudy,
} from "../../lib/caseStudies";
import { compressImageFiles } from "../../lib/compressImage";
import clsx from "clsx";
import {
  DAY_KEYS,
  DAY_LABELS,
  defaultWeeklyAvailability,
  normalizeWeeklyAvailability,
  type WeeklyAvailability,
} from "../../lib/availability";

export function ProfilePage() {
  const { success, error } = useToast();
  const [profile, setProfile] = useState<TradespersonProfile | null>(null);
  const [licenseUploading, setLicenseUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    skills: "",
    serviceAreas: "",
    bio: "",
    yearsExperience: "",
    hourlyRateMin: "",
    hourlyRateMax: "",
    city: "",
  });
  const [week, setWeek] = useState<WeeklyAvailability>(defaultWeeklyAvailability());
  const [blockedDates, setBlockedDates] = useState<string[]>([]);
  const [blockDateInput, setBlockDateInput] = useState("");
  const [notInterested, setNotInterested] = useState<string[]>([]);
  const [customPackages, setCustomPackages] = useState<CustomRatePackage[]>([]);
  const [pkgDraft, setPkgDraft] = useState({
    label: "",
    hint: "",
    amountMin: "",
    amountMax: "",
    unit: "",
  });
  const [pkgEditId, setPkgEditId] = useState<string | null>(null);
  const [caseStudies, setCaseStudies] = useState<CaseStudy[]>([]);
  const [caseDraft, setCaseDraft] = useState({
    title: "",
    notes: "",
    beforeUrl: "",
    afterUrl: "",
    category: "",
  });
  const [caseEditId, setCaseEditId] = useState<string | null>(null);

  useEffect(() => {
    getProfile()
      .then((r) => {
        setProfile(r.profile);
        setForm({
          skills: r.profile.skills || "",
          serviceAreas: r.profile.serviceAreas || "",
          bio: r.profile.bio || "",
          yearsExperience: r.profile.yearsExperience?.toString() || "",
          hourlyRateMin: r.profile.hourlyRateMin?.toString() || "",
          hourlyRateMax: r.profile.hourlyRateMax?.toString() || "",
          city: r.profile.city || "",
        });
        setWeek(normalizeWeeklyAvailability(r.profile.weeklyAvailability));
        setBlockedDates(r.profile.blockedDates || []);
        setNotInterested(r.profile.notInterestedCategories || []);
        setCustomPackages(normalizeCustomRatePackages(r.profile.customRatePackages));
        setCaseStudies(normalizeCaseStudies(r.profile.caseStudies));
      })
      .catch((e) => error(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await updateProfile({
        skills: form.skills,
        serviceAreas: form.serviceAreas,
        bio: form.bio,
        city: form.city,
        yearsExperience: form.yearsExperience ? Number(form.yearsExperience) : undefined,
        hourlyRateMin: form.hourlyRateMin ? Number(form.hourlyRateMin) : undefined,
        hourlyRateMax: form.hourlyRateMax ? Number(form.hourlyRateMax) : undefined,
        weeklyAvailability: week,
        blockedDates,
        notInterestedCategories: notInterested,
        customRatePackages: customPackages,
        caseStudies,
      });
      setProfile(r.profile);
      setWeek(normalizeWeeklyAvailability(r.profile.weeklyAvailability));
      setBlockedDates(r.profile.blockedDates || []);
      setNotInterested(r.profile.notInterestedCategories || []);
      setCustomPackages(normalizeCustomRatePackages(r.profile.customRatePackages));
      setCaseStudies(normalizeCaseStudies(r.profile.caseStudies));
      success("Portfolio updated");
    } catch (err: any) {
      error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onGalleryPick(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const compressed = await compressImageFiles(Array.from(files).slice(0, 8));
      const r = await uploadGallery(compressed);
      setProfile(r.profile);
      success("Gallery photos added");
    } catch (err: any) {
      error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function onLicensePick(file: File | undefined) {
    if (!file) return;
    setLicenseUploading(true);
    try {
      const doc = file.type === "application/pdf" ? file : (await compressImageFiles([file]))[0];
      const r = await uploadLicenseDoc(doc);
      setProfile(r.profile);
      success("Document uploaded. An admin will review it.");
    } catch (err) {
      error((err as Error).message || "Upload failed");
    } finally {
      setLicenseUploading(false);
    }
  }

  async function onRemove(url: string) {
    try {
      const r = await removeGalleryImage(url);
      setProfile(r.profile);
      success("Photo removed");
    } catch (err: any) {
      error(err.message);
    }
  }

  if (loading)
    return (
      <Shell title="Portfolio">
        <Spinner />
      </Shell>
    );

  const gallery = profile?.galleryUrls || [];

  return (
    <Shell title="Your portfolio" subtitle="This is what clients see when comparing bids">
      {profile && (
        <div className="mb-6 card flex flex-wrap items-center gap-4 p-4 sm:p-5">
          <div>
            <p className="font-semibold text-lg">{profile.name || profile.email || "Your profile"}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StarRating value={Math.round(Number(profile.averageRating))} readonly />
              <span className="text-sm text-slate-500">({profile.reviewCount} reviews)</span>
              <Badge status={profile.verificationStatus} />
            </div>
          </div>
          {profile.verificationStatus === "pending" && (
            <p className="text-sm text-amber-800 bg-amber-50 rounded-xl px-3 py-2 ring-1 ring-amber-200">
              Waiting for admin verification before you can bid.
            </p>
          )}
          {profile.verificationStatus !== "suspended" && (
            <div className="w-full border-t border-slate-100 pt-3 text-sm">
              <p className="font-medium text-slate-900">Licence or ID document</p>
              <p className="text-xs text-slate-500">
                PDF, JPG, PNG or WebP. Only admins can see it; it's used to verify your account.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {profile.licenseDocUrl ? (
                  <a href={mediaUrl(profile.licenseDocUrl)} target="_blank" rel="noopener noreferrer">
                    View uploaded document
                  </a>
                ) : (
                  <span className="text-slate-500">Nothing uploaded yet.</span>
                )}
                <label className="btn-secondary btn-sm cursor-pointer">
                  {licenseUploading ? "Uploading…" : profile.licenseDocUrl ? "Replace" : "Upload"}
                  <input
                    type="file"
                    className="sr-only"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    disabled={licenseUploading}
                    onChange={(e) => {
                      void onLicensePick(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      <section className="card max-w-3xl p-4 sm:p-6 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-semibold text-lg">Work gallery</h2>
            <p className="text-sm text-slate-500">Up to 12 photos of past jobs (JPEG/PNG).</p>
          </div>
          <label className="btn-secondary btn-sm cursor-pointer touch-target">
            <ImagePlus className="h-4 w-4" />
            {uploading ? "Uploading…" : "Add photos"}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={uploading || gallery.length >= 12}
              onChange={(e) => {
                onGalleryPick(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {gallery.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center border border-dashed border-slate-200 rounded-xl">
            No gallery photos yet — upload examples of your work.
          </p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {gallery.map((url) => (
              <li key={url} className="relative group aspect-[4/3] overflow-hidden rounded-xl bg-slate-100">
                <img src={mediaUrl(url)} alt="Portfolio" className="h-full w-full object-cover" />
                <button
                  type="button"
                  className="absolute right-2 top-2 rounded-lg bg-white/90 p-2 text-rose-600 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition shadow touch-target"
                  onClick={() => onRemove(url)}
                  aria-label="Remove photo"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={onSubmit} className="card max-w-2xl space-y-4 p-4 sm:p-6 mb-6">
        <div>
          <label className="label">Bio</label>
          <textarea
            className="input min-h-[100px]"
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Skills / specialties</label>
          <p className="text-xs text-slate-500 mb-2">
            Select the lead specialties you offer (saved as your skills list).
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {CATEGORIES.filter((c) => c.value !== "other").map((c) => {
              const parts = form.skills
                .split(",")
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
              const on =
                parts.includes(c.value.toLowerCase()) ||
                parts.includes(c.label.toLowerCase());
              return (
                <button
                  key={c.value}
                  type="button"
                  className={
                    on
                      ? "rounded-full bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-900 ring-1 ring-brand-200"
                      : "rounded-full bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200"
                  }
                  onClick={() => {
                    const tokens = form.skills
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    const drop = new Set(
                      [c.value, c.label].map((x) => x.toLowerCase())
                    );
                    let next = tokens.filter((t) => !drop.has(t.toLowerCase()));
                    if (!on) next = [...next, c.label];
                    setForm({ ...form, skills: next.join(", ") });
                  }}
                >
                  {c.emoji} {c.label}
                </button>
              );
            })}
          </div>
          <label className="label">Extra skills (optional)</label>
          <input
            className="input"
            placeholder="Freeform extras beyond the chips above"
            value={form.skills}
            onChange={(e) => setForm({ ...form, skills: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Not interested categories</label>
          <p className="text-xs text-slate-500 mb-2">
            Soft-skip: clients won’t see you in suggested professionals for these categories (direct invites still possible).
          </p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => {
              const on = notInterested.includes(c.value);
              return (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={on}
                  className={
                    on
                      ? "rounded-full bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-800 ring-1 ring-rose-200"
                      : "rounded-full bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200"
                  }
                  onClick={() =>
                    setNotInterested((prev) =>
                      on ? prev.filter((x) => x !== c.value) : [...prev, c.value]
                    )
                  }
                >
                  {c.emoji} {c.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="label">Service areas</label>
          <p className="mb-2 text-xs text-slate-500">
            Multi-select neighborhoods you cover (saved as a comma-separated list).
          </p>
          <div
            className="mb-3 flex flex-wrap gap-2"
            role="group"
            aria-label="Service areas"
          >
            {SERVICE_AREA_OPTIONS.map((area) => {
              const selected = parseServiceAreas(form.serviceAreas).includes(area);
              return (
                <button
                  key={area}
                  type="button"
                  aria-pressed={selected}
                  className={clsx(
                    "rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition",
                    selected
                      ? "bg-brand-50 text-brand-900 ring-brand-200"
                      : "bg-slate-50 text-slate-600 ring-slate-200 hover:bg-white"
                  )}
                  onClick={() => {
                    const cur = parseServiceAreas(form.serviceAreas);
                    const next = selected
                      ? cur.filter((a) => a !== area)
                      : [...cur, area];
                    setForm({ ...form, serviceAreas: joinServiceAreas(next) });
                  }}
                >
                  {area}
                </button>
              );
            })}
          </div>
          <label className="label">Extra areas (optional)</label>
          <input
            className="input"
            placeholder="Add any areas not listed above"
            value={form.serviceAreas}
            onChange={(e) => setForm({ ...form, serviceAreas: e.target.value })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">City</label>
            <input
              className="input"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Years experience</label>
            <input
              className="input"
              type="number"
              min={0}
              value={form.yearsExperience}
              onChange={(e) => setForm({ ...form, yearsExperience: e.target.value })}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Hourly rate min (₹)</label>
            <input
              className="input"
              type="number"
              value={form.hourlyRateMin}
              onChange={(e) => setForm({ ...form, hourlyRateMin: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Hourly rate max (₹)</label>
            <input
              className="input"
              type="number"
              value={form.hourlyRateMax}
              onChange={(e) => setForm({ ...form, hourlyRateMax: e.target.value })}
            />
          </div>
        </div>

        {softRatePackages(form.hourlyRateMin, form.hourlyRateMax).length > 0 && (
          <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Soft package preview
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Estimates from your hourly range — clients see these as guidance, not binding quotes.
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-3">
              {softRatePackages(form.hourlyRateMin, form.hourlyRateMax).map((p) => (
                <li
                  key={p.id}
                  className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200"
                >
                  <p className="text-sm font-semibold text-slate-900">{p.label}</p>
                  <p className="text-xs text-slate-500">{p.hint}</p>
                  <p className="mt-1 text-sm font-medium text-brand-800">{p.display}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Custom rate packages
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Editable packages beyond soft hourly estimates — clients see these on your public profile.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="input !py-1.5 text-sm"
              placeholder="Label (e.g. Leak fix visit)"
              maxLength={80}
              value={pkgDraft.label}
              onChange={(e) => setPkgDraft({ ...pkgDraft, label: e.target.value })}
              aria-label="Package label"
            />
            <input
              className="input !py-1.5 text-sm"
              placeholder="Unit (optional, e.g. job / room)"
              maxLength={40}
              value={pkgDraft.unit}
              onChange={(e) => setPkgDraft({ ...pkgDraft, unit: e.target.value })}
              aria-label="Package unit"
            />
            <input
              className="input !py-1.5 text-sm"
              type="number"
              min={0}
              placeholder="Min ₹"
              value={pkgDraft.amountMin}
              onChange={(e) => setPkgDraft({ ...pkgDraft, amountMin: e.target.value })}
              aria-label="Package amount min"
            />
            <input
              className="input !py-1.5 text-sm"
              type="number"
              min={0}
              placeholder="Max ₹ (optional)"
              value={pkgDraft.amountMax}
              onChange={(e) => setPkgDraft({ ...pkgDraft, amountMax: e.target.value })}
              aria-label="Package amount max"
            />
            <input
              className="input !py-1.5 text-sm sm:col-span-2"
              placeholder="Hint (optional)"
              maxLength={160}
              value={pkgDraft.hint}
              onChange={(e) => setPkgDraft({ ...pkgDraft, hint: e.target.value })}
              aria-label="Package hint"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={!pkgDraft.label.trim() || !pkgDraft.amountMin}
              onClick={() => {
                const amountMin = Number(pkgDraft.amountMin);
                if (!pkgDraft.label.trim() || !Number.isFinite(amountMin) || amountMin < 0) return;
                const amountMaxRaw = pkgDraft.amountMax ? Number(pkgDraft.amountMax) : undefined;
                const amountMax =
                  amountMaxRaw != null && Number.isFinite(amountMaxRaw) && amountMaxRaw >= amountMin
                    ? amountMaxRaw
                    : undefined;
                const entry: CustomRatePackage = {
                  id: pkgEditId || newCustomPackageId(),
                  label: pkgDraft.label.trim(),
                  amountMin: Math.round(amountMin),
                  ...(amountMax != null ? { amountMax } : {}),
                  ...(pkgDraft.hint.trim() ? { hint: pkgDraft.hint.trim() } : {}),
                  ...(pkgDraft.unit.trim() ? { unit: pkgDraft.unit.trim() } : {}),
                };
                setCustomPackages((prev) => {
                  const rest = prev.filter((x) => x.id !== entry.id);
                  return [entry, ...rest].slice(0, 12);
                });
                setPkgEditId(null);
                setPkgDraft({ label: "", hint: "", amountMin: "", amountMax: "", unit: "" });
              }}
            >
              {pkgEditId ? "Save package" : "Add package"}
            </button>
            {pkgEditId && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  setPkgEditId(null);
                  setPkgDraft({ label: "", hint: "", amountMin: "", amountMax: "", unit: "" });
                }}
              >
                Cancel edit
              </button>
            )}
          </div>
          {customPackages.length > 0 ? (
            <ul className="space-y-2">
              {customPackages.map((pkg) => (
                <li
                  key={pkg.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{pkg.label}</p>
                    {pkg.hint && <p className="text-[11px] text-slate-500">{pkg.hint}</p>}
                    <p className="mt-0.5 text-sm font-medium text-brand-800">
                      {formatCustomPackage(pkg)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => {
                        setPkgEditId(pkg.id);
                        setPkgDraft({
                          label: pkg.label,
                          hint: pkg.hint || "",
                          amountMin: String(pkg.amountMin),
                          amountMax: pkg.amountMax != null ? String(pkg.amountMax) : "",
                          unit: pkg.unit || "",
                        });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm text-rose-700"
                      onClick={() =>
                        setCustomPackages((prev) => prev.filter((x) => x.id !== pkg.id))
                      }
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">
              No custom packages yet — add visit fees, room rates, or fixed-scope bundles.
            </p>
          )}
        </div>


        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Past work case studies
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Before/after cards with notes — shown on your public profile for clients comparing bids.
              Paste gallery or upload URLs (e.g. from Work gallery above).
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="input !py-1.5 text-sm sm:col-span-2"
              placeholder="Title (e.g. Kitchen leak repair)"
              maxLength={120}
              value={caseDraft.title}
              onChange={(e) => setCaseDraft({ ...caseDraft, title: e.target.value })}
              aria-label="Case study title"
            />
            <input
              className="input !py-1.5 text-sm"
              placeholder="Before photo URL (optional)"
              maxLength={500}
              value={caseDraft.beforeUrl}
              onChange={(e) => setCaseDraft({ ...caseDraft, beforeUrl: e.target.value })}
              aria-label="Before photo URL"
            />
            <input
              className="input !py-1.5 text-sm"
              placeholder="After photo URL (optional)"
              maxLength={500}
              value={caseDraft.afterUrl}
              onChange={(e) => setCaseDraft({ ...caseDraft, afterUrl: e.target.value })}
              aria-label="After photo URL"
            />
            <input
              className="input !py-1.5 text-sm"
              placeholder="Category (optional)"
              maxLength={40}
              value={caseDraft.category}
              onChange={(e) => setCaseDraft({ ...caseDraft, category: e.target.value })}
              aria-label="Case study category"
            />
            <textarea
              className="input !py-1.5 text-sm sm:col-span-2 min-h-[72px]"
              placeholder="Notes — what changed, materials, outcome"
              maxLength={800}
              value={caseDraft.notes}
              onChange={(e) => setCaseDraft({ ...caseDraft, notes: e.target.value })}
              aria-label="Case study notes"
            />
          </div>
          {gallery.length > 0 && (
            <div>
              <p className="text-[11px] text-slate-500 mb-1.5">Quick-pick from gallery</p>
              <ul className="flex flex-wrap gap-2" role="list">
                {gallery.slice(0, 8).map((url) => (
                  <li key={url}>
                    <button
                      type="button"
                      className="overflow-hidden rounded-lg ring-1 ring-slate-200 hover:ring-brand-400"
                      title="Use as before or after"
                      onClick={() => {
                        if (!caseDraft.beforeUrl) {
                          setCaseDraft({ ...caseDraft, beforeUrl: url });
                        } else if (!caseDraft.afterUrl) {
                          setCaseDraft({ ...caseDraft, afterUrl: url });
                        } else {
                          setCaseDraft({ ...caseDraft, afterUrl: url });
                        }
                      }}
                    >
                      <img src={mediaUrl(url)} alt="" className="h-12 w-12 object-cover" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={!caseDraft.title.trim()}
              onClick={() => {
                if (!caseDraft.title.trim()) return;
                const entry: CaseStudy = {
                  id: caseEditId || newCaseStudyId(),
                  title: caseDraft.title.trim(),
                  ...(caseDraft.notes.trim() ? { notes: caseDraft.notes.trim() } : {}),
                  ...(caseDraft.beforeUrl.trim()
                    ? { beforeUrl: caseDraft.beforeUrl.trim() }
                    : {}),
                  ...(caseDraft.afterUrl.trim() ? { afterUrl: caseDraft.afterUrl.trim() } : {}),
                  ...(caseDraft.category.trim()
                    ? { category: caseDraft.category.trim() }
                    : {}),
                };
                setCaseStudies((prev) => {
                  const rest = prev.filter((x) => x.id !== entry.id);
                  return [entry, ...rest].slice(0, 12);
                });
                setCaseEditId(null);
                setCaseDraft({
                  title: "",
                  notes: "",
                  beforeUrl: "",
                  afterUrl: "",
                  category: "",
                });
              }}
            >
              {caseEditId ? "Save case study" : "Add case study"}
            </button>
            {caseEditId && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  setCaseEditId(null);
                  setCaseDraft({
                    title: "",
                    notes: "",
                    beforeUrl: "",
                    afterUrl: "",
                    category: "",
                  });
                }}
              >
                Cancel edit
              </button>
            )}
          </div>
          {caseStudies.length > 0 ? (
            <ul className="space-y-3">
              {caseStudies.map((cs) => (
                <li
                  key={cs.id}
                  className="rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200 space-y-2"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{cs.title}</p>
                      {cs.category && (
                        <p className="text-[11px] text-slate-500">{cs.category}</p>
                      )}
                      {cs.notes && (
                        <p className="mt-1 text-xs text-slate-600 whitespace-pre-wrap">
                          {cs.notes}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => {
                          setCaseEditId(cs.id);
                          setCaseDraft({
                            title: cs.title,
                            notes: cs.notes || "",
                            beforeUrl: cs.beforeUrl || "",
                            afterUrl: cs.afterUrl || "",
                            category: cs.category || "",
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-rose-700"
                        onClick={() =>
                          setCaseStudies((prev) => prev.filter((x) => x.id !== cs.id))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {(cs.beforeUrl || cs.afterUrl) && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="overflow-hidden rounded-lg bg-slate-100 aspect-[4/3]">
                        {cs.beforeUrl ? (
                          <img
                            src={mediaUrl(cs.beforeUrl)}
                            alt="Before"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <p className="flex h-full items-center justify-center text-[11px] text-slate-400">
                            Before
                          </p>
                        )}
                      </div>
                      <div className="overflow-hidden rounded-lg bg-slate-100 aspect-[4/3]">
                        {cs.afterUrl ? (
                          <img
                            src={mediaUrl(cs.afterUrl)}
                            alt="After"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <p className="flex h-full items-center justify-center text-[11px] text-slate-400">
                            After
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">
              No case studies yet — add a before/after story from a completed job.
            </p>
          )}
        </div>

        <div className="border-t border-slate-100 pt-4">
          <h3 className="font-semibold text-slate-900">Weekly availability</h3>
          <p className="mt-1 text-xs text-slate-500 mb-3">
            Usual hours on your public profile. Add a second window per day if you split morning / afternoon.
            Visit proposals use these for soft conflict hints.
          </p>
          <ul className="space-y-3">
            {DAY_KEYS.map((day) => {
              const slots = week[day].slots?.length
                ? week[day].slots!
                : [{ start: week[day].start, end: week[day].end }];
              return (
                <li
                  key={day}
                  className="rounded-xl border border-slate-200 px-3 py-2.5 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300"
                        checked={week[day].enabled}
                        onChange={(e) =>
                          setWeek({
                            ...week,
                            [day]: { ...week[day], enabled: e.target.checked },
                          })
                        }
                      />
                      {DAY_LABELS[day]}
                    </label>
                    {week[day].enabled && slots.length < 4 && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-xs"
                        onClick={() => {
                          const next = [...slots, { start: "14:00", end: "18:00" }];
                          setWeek({
                            ...week,
                            [day]: {
                              ...week[day],
                              slots: next,
                              start: next[0].start,
                              end: next[0].end,
                            },
                          });
                        }}
                      >
                        + Slot
                      </button>
                    )}
                  </div>
                  {week[day].enabled &&
                    slots.map((slot, idx) => (
                      <div key={idx} className="flex flex-wrap items-center gap-2 pl-6">
                        <input
                          type="time"
                          className="input py-2"
                          value={slot.start}
                          onChange={(e) => {
                            const next = slots.map((s, i) =>
                              i === idx ? { ...s, start: e.target.value } : s
                            );
                            setWeek({
                              ...week,
                              [day]: {
                                ...week[day],
                                slots: next,
                                start: next[0].start,
                                end: next[0].end,
                              },
                            });
                          }}
                        />
                        <span className="text-xs text-slate-400">to</span>
                        <input
                          type="time"
                          className="input py-2"
                          value={slot.end}
                          onChange={(e) => {
                            const next = slots.map((s, i) =>
                              i === idx ? { ...s, end: e.target.value } : s
                            );
                            setWeek({
                              ...week,
                              [day]: {
                                ...week[day],
                                slots: next,
                                start: next[0].start,
                                end: next[0].end,
                              },
                            });
                          }}
                        />
                        {slots.length > 1 && (
                          <button
                            type="button"
                            className="btn-ghost btn-sm text-xs text-rose-600"
                            onClick={() => {
                              const next = slots.filter((_, i) => i !== idx);
                              setWeek({
                                ...week,
                                [day]: {
                                  ...week[day],
                                  slots: next,
                                  start: next[0].start,
                                  end: next[0].end,
                                },
                              });
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <h3 className="font-semibold text-slate-900">Blocked dates</h3>
          <p className="mt-1 text-xs text-slate-500 mb-3">
            Full days you are unavailable (holidays, leave). Visit proposals on these dates show a conflict hint.
          </p>
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div>
              <label className="label">Add date</label>
              <input
                type="date"
                className="input"
                value={blockDateInput}
                onChange={(e) => setBlockDateInput(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                if (!blockDateInput) return;
                if (blockedDates.includes(blockDateInput)) return;
                setBlockedDates([...blockedDates, blockDateInput].sort());
                setBlockDateInput("");
              }}
            >
              Add
            </button>
          </div>
          {blockedDates.length === 0 ? (
            <p className="text-xs text-slate-400">No blocked dates</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {blockedDates.map((d) => (
                <li
                  key={d}
                  className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200"
                >
                  {d}
                  <button
                    type="button"
                    className="text-amber-700 hover:text-rose-600"
                    aria-label={`Remove ${d}`}
                    onClick={() => setBlockedDates(blockedDates.filter((x) => x !== d))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button type="submit" className="btn-primary w-full sm:w-auto touch-target" disabled={busy}>
          {busy ? "Saving…" : "Save portfolio"}
        </button>
      </form>
    </Shell>
  );
}
