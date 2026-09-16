import { FormEvent, useEffect, useState } from "react";
import { Shell } from "../components/Shell";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import {
  DEFAULT_NOTIF_PREFS,
  NOTIF_PREF_META,
  mergeNotifPrefs,
  writeLocalNotifPrefs,
  type NotifPrefKey,
} from "../lib/notifPrefs";
import {
  DEFAULT_INVITE_STARTERS,
  deleteInviteTemplate,
  loadUserInviteTemplates,
  mergeInviteTemplates,
  saveUserInviteTemplates,
  upsertInviteTemplate,
  type InviteTemplate,
} from "../lib/inviteTemplates";
import {
  DEFAULT_COUNTER_STARTERS,
  deleteCounterTemplate,
  loadUserCounterTemplates,
  mergeCounterTemplates,
  saveUserCounterTemplates,
  upsertCounterTemplate,
  type CounterTemplate,
} from "../lib/counterTemplates";
import {
  DEFAULT_HOMEOWNER_COUNTER_NOTES,
  deleteHomeownerCounterNote,
  loadHomeownerCounterNotes,
  mergeHomeownerCounterNotes,
  saveHomeownerCounterNotes,
  upsertHomeownerCounterNote,
  type HomeownerCounterNoteTemplate,
} from "../lib/homeownerCounterNotes";
import {
  DEFAULT_INTRO_STARTERS,
  deleteIntroTemplate,
  loadUserIntroTemplates,
  mergeIntroTemplates,
  saveUserIntroTemplates,
  upsertIntroTemplate,
  type IntroTemplate,
} from "../lib/introTemplates";
import {
  deleteNamedJobTemplate,
  loadNamedJobTemplates,
  mergeNamedJobTemplates,
  saveNamedJobTemplates,
  type NamedJobTemplate,
} from "../lib/namedJobTemplates";

export function SettingsPage() {
  const { user, updateProfile } = useAuth();
  const { success, error } = useToast();
  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [prefs, setPrefs] = useState(DEFAULT_NOTIF_PREFS);
  const [busy, setBusy] = useState(false);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [templates, setTemplates] = useState<InviteTemplate[]>([]);
  const [tplBusy, setTplBusy] = useState(false);
  const [counterTpls, setCounterTpls] = useState<CounterTemplate[]>([]);
  const [ctrBusy, setCtrBusy] = useState(false);
  const [hoCtrTpls, setHoCtrTpls] = useState<HomeownerCounterNoteTemplate[]>([]);
  const [hoCtrBusy, setHoCtrBusy] = useState(false);
  const [hoEditId, setHoEditId] = useState<string | null>(null);
  const [hoDraftLabel, setHoDraftLabel] = useState("");
  const [hoDraftBody, setHoDraftBody] = useState("");
  const [invEditId, setInvEditId] = useState<string | null>(null);
  const [invDraftLabel, setInvDraftLabel] = useState("");
  const [invDraftBody, setInvDraftBody] = useState("");
  const [ctrEditId, setCtrEditId] = useState<string | null>(null);
  const [ctrDraftLabel, setCtrDraftLabel] = useState("");
  const [ctrDraftBody, setCtrDraftBody] = useState("");
  const [introTpls, setIntroTpls] = useState<IntroTemplate[]>([]);
  const [introBusy, setIntroBusy] = useState(false);
  const [introEditId, setIntroEditId] = useState<string | null>(null);
  const [introDraftLabel, setIntroDraftLabel] = useState("");
  const [introDraftBody, setIntroDraftBody] = useState("");
  const [namedJobs, setNamedJobs] = useState<NamedJobTemplate[]>([]);
  const [namedBusy, setNamedBusy] = useState(false);
  const [nudgeHours, setNudgeHours] = useState("4");
  const [nudgeBusy, setNudgeBusy] = useState(false);

  useEffect(() => {
    setName(user?.name || "");
    setPhone(user?.phone || "");
    setPrefs(mergeNotifPrefs(user?.notificationPrefs));
    setTemplates(mergeInviteTemplates(user?.inviteTemplates));
    setHoCtrTpls(mergeHomeownerCounterNotes(user?.homeownerCounterTemplates));
    setCounterTpls(mergeCounterTemplates(user?.counterTemplates));
    setIntroTpls(mergeIntroTemplates(user?.introTemplates));
    setNamedJobs(mergeNamedJobTemplates(user?.namedJobTemplates));
    if (user?.quoteViewNudgeHours != null) setNudgeHours(String(user.quoteViewNudgeHours));
  }, [user]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateProfile({ name: name.trim(), phone: phone.trim() });
      success("Profile updated");
    } catch (err: any) {
      error(err.message || "Update failed");
    } finally {
      setBusy(false);
    }
  }

  function togglePref(key: NotifPrefKey) {
    setPrefs((p) => ({ ...p, [key]: !p[key] }));
  }

  async function savePrefs() {
    setPrefsBusy(true);
    try {
      writeLocalNotifPrefs(prefs);
      await updateProfile({ notificationPrefs: prefs });
      success("Notification preferences saved");
    } catch (err: any) {
      writeLocalNotifPrefs(prefs);
      error(err.message || "Saved locally only — server update failed");
    } finally {
      setPrefsBusy(false);
    }
  }

  return (
    <Shell title="Settings" subtitle="Account details and notification preferences">
      <div className="space-y-6 max-w-lg">
        <form onSubmit={onSubmit} className="card space-y-4 p-5 sm:p-6">
          <div>
            <label className="label">Email</label>
            <input className="input bg-slate-50" value={user?.email || ""} disabled />
          </div>
          <div>
            <label className="label" htmlFor="name">
              Display name
            </label>
            <input
              id="name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="phone">
              Phone
            </label>
            <input
              id="phone"
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <p className="text-xs text-slate-500">Role: {user?.role}</p>
          <button type="submit" className="btn-primary w-full sm:w-auto" disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
          </button>
        </form>

        <section className="card space-y-4 p-5 sm:p-6">
          <div>
            <h2 className="font-semibold text-slate-900">Notification preferences</h2>
            <p className="mt-1 text-sm text-slate-500">
              Choose which in-app alerts you want. Saved to your account and this browser.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {NOTIF_PREF_META.map((item) => (
              <li
                key={item.key}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{item.label}</p>
                  <p className="text-xs text-slate-500">{item.hint}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs[item.key]}
                  onClick={() => togglePref(item.key)}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                    prefs[item.key] ? "bg-brand-600" : "bg-slate-200"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition ${
                      prefs[item.key] ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn-primary w-full sm:w-auto"
            disabled={prefsBusy}
            onClick={savePrefs}
          >
            {prefsBusy ? "Saving…" : "Save preferences"}
          </button>
        </section>

        {user?.role === "HOMEOWNER" && (
          <section className="card space-y-4 p-5 sm:p-6">
            <div>
              <h2 className="font-semibold text-slate-900">Invite message templates</h2>
              <p className="mt-1 text-sm text-slate-500">
                Create, edit, and sync chips for inviting pros. Stored in this browser; Sync uploads them to your account.
              </p>
            </div>
            <div className="space-y-3 rounded-xl bg-brand-50/50 p-3 ring-1 ring-brand-100">
              <p className="text-xs font-medium text-slate-700">
                {invEditId ? "Edit invite template" : "New invite template"}
              </p>
              <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
                <input
                  className="input !py-1.5 text-sm"
                  placeholder="Label"
                  maxLength={80}
                  value={invDraftLabel}
                  onChange={(e) => setInvDraftLabel(e.target.value)}
                  aria-label="Invite template label"
                />
                <textarea
                  className="input min-h-[64px] text-sm"
                  placeholder="Message body for inviting a pro…"
                  maxLength={500}
                  value={invDraftBody}
                  onChange={(e) => setInvDraftBody(e.target.value)}
                  aria-label="Invite template body"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={!invDraftBody.trim()}
                  onClick={() => {
                    if (!invDraftBody.trim()) return;
                    const base =
                      loadUserInviteTemplates().length > 0
                        ? loadUserInviteTemplates()
                        : templates.length
                          ? templates
                          : DEFAULT_INVITE_STARTERS;
                    saveUserInviteTemplates(base);
                    const next = upsertInviteTemplate({
                      id: invEditId || `tpl-${Date.now()}`,
                      label: invDraftLabel.trim() || "Custom invite",
                      body: invDraftBody.trim(),
                      createdAt: invEditId
                        ? base.find((x) => x.id === invEditId)?.createdAt
                        : undefined,
                    });
                    setTemplates(next);
                    setInvEditId(null);
                    setInvDraftLabel("");
                    setInvDraftBody("");
                    success(invEditId ? "Invite template updated" : "Invite template saved");
                  }}
                >
                  {invEditId ? "Save changes" : "Add template"}
                </button>
                {invEditId && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => {
                      setInvEditId(null);
                      setInvDraftLabel("");
                      setInvDraftBody("");
                    }}
                  >
                    Cancel edit
                  </button>
                )}
              </div>
            </div>
            <ul className="space-y-2">
              {(templates.length ? templates : DEFAULT_INVITE_STARTERS).map((tpl) => {
                const isDefault = DEFAULT_INVITE_STARTERS.some((s) => s.id === tpl.id);
                const isEditing = invEditId === tpl.id;
                return (
                  <li
                    key={tpl.id}
                    className={
                      isEditing
                        ? "flex items-start justify-between gap-3 rounded-xl bg-brand-50 px-3 py-2 ring-1 ring-brand-200"
                        : "flex items-start justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200"
                    }
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        {tpl.label}
                        {isDefault ? (
                          <span className="ml-1.5 rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-normal text-slate-600">
                            default
                          </span>
                        ) : (
                          <span className="ml-1.5 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-normal text-brand-800">
                            custom
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 line-clamp-2">{tpl.body}</p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => {
                          setInvEditId(tpl.id);
                          setInvDraftLabel(tpl.label);
                          setInvDraftBody(tpl.body);
                        }}
                      >
                        Edit
                      </button>
                      {!isDefault && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm text-rose-700"
                          onClick={() => {
                            deleteInviteTemplate(tpl.id);
                            const next = loadUserInviteTemplates();
                            setTemplates(next.length ? next : DEFAULT_INVITE_STARTERS);
                            if (invEditId === tpl.id) {
                              setInvEditId(null);
                              setInvDraftLabel("");
                              setInvDraftBody("");
                            }
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  saveUserInviteTemplates(DEFAULT_INVITE_STARTERS);
                  setTemplates(DEFAULT_INVITE_STARTERS);
                  setInvEditId(null);
                  setInvDraftLabel("");
                  setInvDraftBody("");
                  success("Restored default invite templates");
                }}
              >
                Reset defaults
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={tplBusy}
                onClick={async () => {
                  setTplBusy(true);
                  try {
                    const list = loadUserInviteTemplates().length
                      ? loadUserInviteTemplates()
                      : DEFAULT_INVITE_STARTERS;
                    await updateProfile({ inviteTemplates: list });
                    saveUserInviteTemplates(list);
                    setTemplates(list);
                    success("Invite templates synced to account");
                  } catch (err: any) {
                    error(err.message || "Sync failed");
                  } finally {
                    setTplBusy(false);
                  }
                }}
              >
                {tplBusy ? "Syncing…" : "Sync templates to account"}
              </button>
            </div>
          </section>
        )}


        {user?.role === "HOMEOWNER" && (
          <section className="card space-y-4 p-5 sm:p-6">
            <div>
              <h2 className="font-semibold text-slate-900">Counter-offer note templates</h2>
              <p className="mt-1 text-sm text-slate-500">
                Create, edit, and sync chips for request-revise notes on bid compare. Stored in this browser; Sync uploads them to your account.
              </p>
            </div>
            <div className="space-y-3 rounded-xl bg-brand-50/50 p-3 ring-1 ring-brand-100">
              <p className="text-xs font-medium text-slate-700">
                {hoEditId ? "Edit template" : "New custom note"}
              </p>
              <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
                <input
                  className="input !py-1.5 text-sm"
                  placeholder="Label"
                  maxLength={80}
                  value={hoDraftLabel}
                  onChange={(e) => setHoDraftLabel(e.target.value)}
                  aria-label="Note template label"
                />
                <textarea
                  className="input min-h-[64px] text-sm sm:col-span-1"
                  placeholder="Note body shown when you request a revise…"
                  maxLength={500}
                  value={hoDraftBody}
                  onChange={(e) => setHoDraftBody(e.target.value)}
                  aria-label="Note template body"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={!hoDraftBody.trim()}
                  onClick={() => {
                    if (!hoDraftBody.trim()) return;
                    // Seed localStorage from the list currently shown (defaults or custom)
                    // so editing a built-in chip doesn't wipe the rest of the chips.
                    const base =
                      loadHomeownerCounterNotes().length > 0
                        ? loadHomeownerCounterNotes()
                        : hoCtrTpls.length
                          ? hoCtrTpls
                          : DEFAULT_HOMEOWNER_COUNTER_NOTES;
                    saveHomeownerCounterNotes(base);
                    const next = upsertHomeownerCounterNote({
                      id: hoEditId || `ho-ctr-${Date.now()}`,
                      label: hoDraftLabel.trim() || "Custom note",
                      body: hoDraftBody.trim(),
                      createdAt: hoEditId
                        ? base.find((x) => x.id === hoEditId)?.createdAt
                        : undefined,
                    });
                    setHoCtrTpls(next);
                    setHoEditId(null);
                    setHoDraftLabel("");
                    setHoDraftBody("");
                    success(hoEditId ? "Note template updated" : "Custom note saved");
                  }}
                >
                  {hoEditId ? "Save changes" : "Add note"}
                </button>
                {hoEditId && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => {
                      setHoEditId(null);
                      setHoDraftLabel("");
                      setHoDraftBody("");
                    }}
                  >
                    Cancel edit
                  </button>
                )}
              </div>
            </div>
            <ul className="space-y-2">
              {(hoCtrTpls.length ? hoCtrTpls : DEFAULT_HOMEOWNER_COUNTER_NOTES).map((tpl) => {
                const isDefault = DEFAULT_HOMEOWNER_COUNTER_NOTES.some((s) => s.id === tpl.id);
                const isEditing = hoEditId === tpl.id;
                return (
                  <li
                    key={tpl.id}
                    className={
                      isEditing
                        ? "flex items-start justify-between gap-3 rounded-xl bg-brand-50 px-3 py-2 ring-1 ring-brand-200"
                        : "flex items-start justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200"
                    }
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        {tpl.label}
                        {isDefault ? (
                          <span className="ml-1.5 rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-normal text-slate-600">
                            default
                          </span>
                        ) : (
                          <span className="ml-1.5 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-normal text-brand-800">
                            custom
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 line-clamp-2">{tpl.body}</p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => {
                          setHoEditId(tpl.id);
                          setHoDraftLabel(tpl.label);
                          setHoDraftBody(tpl.body);
                        }}
                      >
                        Edit
                      </button>
                      {!isDefault && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm text-rose-700"
                          onClick={() => {
                            deleteHomeownerCounterNote(tpl.id);
                            const next = loadHomeownerCounterNotes();
                            setHoCtrTpls(next.length ? next : DEFAULT_HOMEOWNER_COUNTER_NOTES);
                            if (hoEditId === tpl.id) {
                              setHoEditId(null);
                              setHoDraftLabel("");
                              setHoDraftBody("");
                            }
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  saveHomeownerCounterNotes(DEFAULT_HOMEOWNER_COUNTER_NOTES);
                  setHoCtrTpls(DEFAULT_HOMEOWNER_COUNTER_NOTES);
                  setHoEditId(null);
                  setHoDraftLabel("");
                  setHoDraftBody("");
                  success("Restored default counter notes");
                }}
              >
                Reset defaults
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={hoCtrBusy}
                onClick={async () => {
                  setHoCtrBusy(true);
                  try {
                    const list = loadHomeownerCounterNotes().length
                      ? loadHomeownerCounterNotes()
                      : DEFAULT_HOMEOWNER_COUNTER_NOTES;
                    await updateProfile({ homeownerCounterTemplates: list });
                    saveHomeownerCounterNotes(list);
                    setHoCtrTpls(list);
                    success("Counter note templates synced to account");
                  } catch (err: any) {
                    error(err.message || "Sync failed");
                  } finally {
                    setHoCtrBusy(false);
                  }
                }}
              >
                {hoCtrBusy ? "Syncing…" : "Sync templates to account"}
              </button>
            </div>
          </section>
        )}

        {user?.role === "HOMEOWNER" && (
          <section className="card space-y-4 p-5 sm:p-6">
            <div>
              <h2 className="font-semibold text-slate-900">Named job templates</h2>
              <p className="mt-1 text-sm text-slate-500">
                Library of past completed jobs you saved by name. Apply them on post-job — beyond one-shot repeat. Sync keeps them on your account.
              </p>
            </div>
            {namedJobs.length === 0 ? (
              <p className="text-sm text-slate-500">
                No saved templates yet. On a completed job, use <span className="font-medium">Save as template</span>.
              </p>
            ) : (
              <ul className="space-y-2">
                {namedJobs.map((tpl) => (
                  <li
                    key={tpl.id}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{tpl.name}</p>
                      <p className="text-xs text-slate-500 truncate">{tpl.title}</p>
                    </div>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => {
                        const next = deleteNamedJobTemplate(tpl.id);
                        setNamedJobs(next);
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={namedBusy}
                onClick={async () => {
                  setNamedBusy(true);
                  try {
                    const list = loadNamedJobTemplates();
                    await updateProfile({ namedJobTemplates: list });
                    saveNamedJobTemplates(list);
                    setNamedJobs(list);
                    success("Job templates synced to account");
                  } catch (err: any) {
                    error(err.message || "Sync failed");
                  } finally {
                    setNamedBusy(false);
                  }
                }}
              >
                {namedBusy ? "Syncing…" : "Sync templates to account"}
              </button>
            </div>
          </section>
        )}

        {user?.role === "TRADESPERSON" && (
          <section className="card space-y-4 p-5 sm:p-6">
            <div>
              <h2 className="font-semibold text-slate-900">Counter-offer reply templates</h2>
              <p className="mt-1 text-sm text-slate-500">
                Create, edit, and sync quick replies when declining or negotiating a client counter. Stored in this browser; Sync uploads them to your account.
              </p>
            </div>
            <div className="space-y-3 rounded-xl bg-brand-50/50 p-3 ring-1 ring-brand-100">
              <p className="text-xs font-medium text-slate-700">
                {ctrEditId ? "Edit counter template" : "New counter template"}
              </p>
              <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
                <input
                  className="input !py-1.5 text-sm"
                  placeholder="Label"
                  maxLength={80}
                  value={ctrDraftLabel}
                  onChange={(e) => setCtrDraftLabel(e.target.value)}
                  aria-label="Counter template label"
                />
                <textarea
                  className="input min-h-[64px] text-sm"
                  placeholder="Reply body when addressing a client counter…"
                  maxLength={500}
                  value={ctrDraftBody}
                  onChange={(e) => setCtrDraftBody(e.target.value)}
                  aria-label="Counter template body"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={!ctrDraftBody.trim()}
                  onClick={() => {
                    if (!ctrDraftBody.trim()) return;
                    const base =
                      loadUserCounterTemplates().length > 0
                        ? loadUserCounterTemplates()
                        : counterTpls.length
                          ? counterTpls
                          : DEFAULT_COUNTER_STARTERS;
                    saveUserCounterTemplates(base);
                    const next = upsertCounterTemplate({
                      id: ctrEditId || `ctr-${Date.now()}`,
                      label: ctrDraftLabel.trim() || "Custom reply",
                      body: ctrDraftBody.trim(),
                      createdAt: ctrEditId
                        ? base.find((x) => x.id === ctrEditId)?.createdAt
                        : undefined,
                    });
                    setCounterTpls(next);
                    setCtrEditId(null);
                    setCtrDraftLabel("");
                    setCtrDraftBody("");
                    success(ctrEditId ? "Counter template updated" : "Counter template saved");
                  }}
                >
                  {ctrEditId ? "Save changes" : "Add template"}
                </button>
                {ctrEditId && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => {
                      setCtrEditId(null);
                      setCtrDraftLabel("");
                      setCtrDraftBody("");
                    }}
                  >
                    Cancel edit
                  </button>
                )}
              </div>
            </div>
            <ul className="space-y-2">
              {(counterTpls.length ? counterTpls : DEFAULT_COUNTER_STARTERS).map((tpl) => {
                const isDefault = DEFAULT_COUNTER_STARTERS.some((s) => s.id === tpl.id);
                const isEditing = ctrEditId === tpl.id;
                return (
                  <li
                    key={tpl.id}
                    className={
                      isEditing
                        ? "flex items-start justify-between gap-3 rounded-xl bg-brand-50 px-3 py-2 ring-1 ring-brand-200"
                        : "flex items-start justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200"
                    }
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        {tpl.label}
                        {isDefault ? (
                          <span className="ml-1.5 rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-normal text-slate-600">
                            default
                          </span>
                        ) : (
                          <span className="ml-1.5 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-normal text-brand-800">
                            custom
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 line-clamp-2">{tpl.body}</p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => {
                          setCtrEditId(tpl.id);
                          setCtrDraftLabel(tpl.label);
                          setCtrDraftBody(tpl.body);
                        }}
                      >
                        Edit
                      </button>
                      {!isDefault && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm text-rose-700"
                          onClick={() => {
                            deleteCounterTemplate(tpl.id);
                            const next = loadUserCounterTemplates();
                            setCounterTpls(next.length ? next : DEFAULT_COUNTER_STARTERS);
                            if (ctrEditId === tpl.id) {
                              setCtrEditId(null);
                              setCtrDraftLabel("");
                              setCtrDraftBody("");
                            }
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  saveUserCounterTemplates(DEFAULT_COUNTER_STARTERS);
                  setCounterTpls(DEFAULT_COUNTER_STARTERS);
                  setCtrEditId(null);
                  setCtrDraftLabel("");
                  setCtrDraftBody("");
                  success("Restored default counter templates");
                }}
              >
                Reset defaults
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={ctrBusy}
                onClick={async () => {
                  setCtrBusy(true);
                  try {
                    const list = loadUserCounterTemplates().length
                      ? loadUserCounterTemplates()
                      : DEFAULT_COUNTER_STARTERS;
                    await updateProfile({ counterTemplates: list });
                    saveUserCounterTemplates(list);
                    setCounterTpls(list);
                    success("Counter templates synced to account");
                  } catch (err: any) {
                    error(err.message || "Sync failed");
                  } finally {
                    setCtrBusy(false);
                  }
                }}
              >
                {ctrBusy ? "Syncing…" : "Sync templates to account"}
              </button>
            </div>
          </section>
        )}

        {user?.role === "TRADESPERSON" && (
          <section className="card space-y-4 p-5 sm:p-6">
            <div>
              <h2 className="font-semibold text-slate-900">Intro / first-message templates</h2>
              <p className="mt-1 text-sm text-slate-500">
                Starters for the first in-job chat message when a client awards you. Stored in this browser; Sync uploads them to your account.
              </p>
            </div>
            <div className="space-y-3 rounded-xl bg-brand-50/50 p-3 ring-1 ring-brand-100">
              <p className="text-xs font-medium text-slate-700">
                {introEditId ? "Edit intro template" : "New intro template"}
              </p>
              <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
                <input
                  className="input !py-1.5 text-sm"
                  placeholder="Label"
                  maxLength={80}
                  value={introDraftLabel}
                  onChange={(e) => setIntroDraftLabel(e.target.value)}
                  aria-label="Intro template label"
                />
                <textarea
                  className="input min-h-[64px] text-sm"
                  placeholder="First message to the client…"
                  maxLength={500}
                  value={introDraftBody}
                  onChange={(e) => setIntroDraftBody(e.target.value)}
                  aria-label="Intro template body"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={!introDraftBody.trim()}
                  onClick={() => {
                    if (!introDraftBody.trim()) return;
                    const base =
                      loadUserIntroTemplates().length > 0
                        ? loadUserIntroTemplates()
                        : introTpls.length
                          ? introTpls
                          : DEFAULT_INTRO_STARTERS;
                    saveUserIntroTemplates(base);
                    const next = upsertIntroTemplate({
                      id: introEditId || `intro-${Date.now()}`,
                      label: introDraftLabel.trim() || "Custom intro",
                      body: introDraftBody.trim(),
                      createdAt: introEditId
                        ? base.find((x) => x.id === introEditId)?.createdAt
                        : undefined,
                    });
                    setIntroTpls(next);
                    setIntroEditId(null);
                    setIntroDraftLabel("");
                    setIntroDraftBody("");
                    success(introEditId ? "Intro template updated" : "Intro template saved");
                  }}
                >
                  {introEditId ? "Save changes" : "Add template"}
                </button>
                {introEditId && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => {
                      setIntroEditId(null);
                      setIntroDraftLabel("");
                      setIntroDraftBody("");
                    }}
                  >
                    Cancel edit
                  </button>
                )}
              </div>
            </div>
            <ul className="space-y-2">
              {(introTpls.length ? introTpls : DEFAULT_INTRO_STARTERS).map((tpl) => {
                const isDefault = DEFAULT_INTRO_STARTERS.some((s) => s.id === tpl.id);
                const isEditing = introEditId === tpl.id;
                return (
                  <li
                    key={tpl.id}
                    className={
                      isEditing
                        ? "flex items-start justify-between gap-3 rounded-xl bg-brand-50 px-3 py-2 ring-1 ring-brand-200"
                        : "flex items-start justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200"
                    }
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        {tpl.label}
                        {isDefault ? (
                          <span className="ml-1.5 rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-normal text-slate-600">
                            default
                          </span>
                        ) : (
                          <span className="ml-1.5 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-normal text-brand-800">
                            custom
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 line-clamp-2">{tpl.body}</p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => {
                          setIntroEditId(tpl.id);
                          setIntroDraftLabel(tpl.label);
                          setIntroDraftBody(tpl.body);
                        }}
                      >
                        Edit
                      </button>
                      {!isDefault && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm text-rose-700"
                          onClick={() => {
                            deleteIntroTemplate(tpl.id);
                            const next = loadUserIntroTemplates();
                            setIntroTpls(next.length ? next : DEFAULT_INTRO_STARTERS);
                            if (introEditId === tpl.id) {
                              setIntroEditId(null);
                              setIntroDraftLabel("");
                              setIntroDraftBody("");
                            }
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  saveUserIntroTemplates(DEFAULT_INTRO_STARTERS);
                  setIntroTpls(DEFAULT_INTRO_STARTERS);
                  setIntroEditId(null);
                  setIntroDraftLabel("");
                  setIntroDraftBody("");
                  success("Restored default intro templates");
                }}
              >
                Reset defaults
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={introBusy}
                onClick={async () => {
                  setIntroBusy(true);
                  try {
                    const list = loadUserIntroTemplates().length
                      ? loadUserIntroTemplates()
                      : DEFAULT_INTRO_STARTERS;
                    await updateProfile({ introTemplates: list });
                    saveUserIntroTemplates(list);
                    setIntroTpls(list);
                    success("Intro templates synced to account");
                  } catch (err: any) {
                    error(err.message || "Sync failed");
                  } finally {
                    setIntroBusy(false);
                  }
                }}
              >
                {introBusy ? "Syncing…" : "Sync templates to account"}
              </button>
            </div>
          </section>
        )}

        {(user?.role === "TRADESPERSON" || user?.role === "HOMEOWNER") && (
          <section className="card space-y-4 p-5 sm:p-6">
            <div>
              <h2 className="font-semibold text-slate-900">Viewed-but-no-reply nudge</h2>
              <p className="mt-1 text-sm text-slate-500">
                Hours after a client views a revised quote before a soft in-app nudge (default 4). Applies to professionals; clients can set a preferred demo value on their account too.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label" htmlFor="nudgeHours">
                  Nudge after (hours)
                </label>
                <input
                  id="nudgeHours"
                  className="input w-28"
                  type="number"
                  min={1}
                  max={168}
                  value={nudgeHours}
                  onChange={(e) => setNudgeHours(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn-primary"
                disabled={nudgeBusy}
                onClick={async () => {
                  setNudgeBusy(true);
                  try {
                    const n = Number(nudgeHours);
                    if (!Number.isFinite(n) || n < 1 || n > 168) {
                      error("Enter 1–168 hours");
                      return;
                    }
                    await updateProfile({ quoteViewNudgeHours: Math.round(n) });
                    success(`Nudge set to ${Math.round(n)}h`);
                  } catch (err: any) {
                    error(err.message || "Could not save nudge hours");
                  } finally {
                    setNudgeBusy(false);
                  }
                }}
              >
                {nudgeBusy ? "Saving…" : "Save nudge hours"}
              </button>
            </div>
          </section>
        )}

      </div>
    </Shell>
  );
}
