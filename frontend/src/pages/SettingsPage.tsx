import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shell } from "../components/Shell";
import { TemplateEditor } from "../components/TemplateEditor";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { changePassword, deleteAccount, logoutEverywhere } from "../api/client";
import { DEFAULT_NOTIF_PREFS, NOTIF_PREF_META, mergeNotifPrefs, type NotifPrefKey } from "../lib/notifPrefs";
import { DEFAULT_INVITE_STARTERS, mergeInviteTemplates } from "../lib/inviteTemplates";
import { DEFAULT_COUNTER_STARTERS, mergeCounterTemplates } from "../lib/counterTemplates";
import { DEFAULT_HOMEOWNER_COUNTER_NOTES, mergeHomeownerCounterNotes } from "../lib/homeownerCounterNotes";
import { DEFAULT_INTRO_STARTERS, mergeIntroTemplates } from "../lib/introTemplates";
import { deleteNamedJobTemplate, mergeNamedJobTemplates } from "../lib/namedJobTemplates";

function supportedZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["Asia/Kolkata"];
  }
}

function timeZones(current?: string) {
  const set = new Set(supportedZones());
  set.add("UTC");
  if (current) set.add(current);
  return [...set].sort();
}

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message) || fallback;

export function SettingsPage() {
  const { user, updateProfile, setSessionUser, clearSession } = useAuth();
  const { success, error } = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [timezone, setTimezone] = useState(user?.timezone || "Asia/Kolkata");
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState(DEFAULT_NOTIF_PREFS);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [nudgeHours, setNudgeHours] = useState("4");
  const [nudgeBusy, setNudgeBusy] = useState(false);
  const [namedBusy, setNamedBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  const zones = useMemo(() => timeZones(user?.timezone), [user?.timezone]);
  const namedJobs = useMemo(() => mergeNamedJobTemplates(user?.namedJobTemplates), [user?.namedJobTemplates]);

  useEffect(() => {
    setName(user?.name || "");
    setPhone(user?.phone || "");
    setTimezone(user?.timezone || "Asia/Kolkata");
    setPrefs(mergeNotifPrefs(user?.notificationPrefs));
    if (user?.quoteViewNudgeHours != null) setNudgeHours(String(user.quoteViewNudgeHours));
  }, [user]);

  if (!user) return null;
  const isClient = user.role === "HOMEOWNER";
  const isPro = user.role === "TRADESPERSON";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateProfile({ name: name.trim() || null, phone: phone.trim() || null, timezone });
      success("Profile updated");
    } catch (err) {
      error(message(err, "Update failed"));
    } finally {
      setBusy(false);
    }
  }

  async function savePrefs() {
    setPrefsBusy(true);
    try {
      await updateProfile({ notificationPrefs: prefs });
      success("Notification preferences saved");
    } catch (err) {
      error(message(err, "Couldn't save preferences"));
    } finally {
      setPrefsBusy(false);
    }
  }

  async function saveNudge() {
    const n = Number(nudgeHours);
    if (!Number.isFinite(n) || n < 1 || n > 168) {
      error("Enter 1–168 hours");
      return;
    }
    setNudgeBusy(true);
    try {
      await updateProfile({ quoteViewNudgeHours: Math.round(n) });
      success(`Nudge set to ${Math.round(n)}h`);
    } catch (err) {
      error(message(err, "Could not save nudge hours"));
    } finally {
      setNudgeBusy(false);
    }
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    setPwBusy(true);
    try {
      const session = await changePassword(currentPassword, newPassword);
      setSessionUser(session.user, session.token);
      setCurrentPassword("");
      setNewPassword("");
      success("Password changed. Other devices have been signed out.");
    } catch (err) {
      error(message(err, "Couldn't change password"));
    } finally {
      setPwBusy(false);
    }
  }

  async function onLogoutEverywhere() {
    if (!window.confirm("Sign out on every device, including this one?")) return;
    try {
      await logoutEverywhere();
    } catch (err) {
      error(message(err, "Couldn't sign out everywhere"));
      return;
    }
    clearSession();
    navigate("/login", { replace: true });
  }

  async function onDeleteAccount(e: FormEvent) {
    e.preventDefault();
    if (!window.confirm("Delete your account permanently? Your profile and personal details will be removed.")) return;
    setDeleteBusy(true);
    try {
      await deleteAccount(deletePassword);
      clearSession();
      navigate("/", { replace: true });
    } catch (err) {
      error(message(err, "Couldn't delete account"));
      setDeleteBusy(false);
    }
  }

  return (
    <Shell title="Settings" subtitle="Account, security and notification preferences">
      <div className="max-w-lg space-y-6">
        <form onSubmit={onSubmit} className="card space-y-4 p-5 sm:p-6">
          <div>
            <label className="label" htmlFor="settings-email">
              Email
            </label>
            <input id="settings-email" className="input bg-slate-50" value={user.email} disabled />
            <p className="mt-1 text-xs text-slate-500">
              {user.emailVerified === false ? "Not verified yet — check your inbox." : "Verified"}
            </p>
          </div>
          <div>
            <label className="label" htmlFor="name">
              Display name
            </label>
            <input id="name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="phone">
              Phone
            </label>
            <input
              id="phone"
              className="input"
              type="tel"
              maxLength={20}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="timezone">
              Time zone
            </label>
            <select id="timezone" className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">Used for availability and schedule times.</p>
          </div>
          <button type="submit" className="btn-primary w-full sm:w-auto" disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
          </button>
        </form>

        <section className="card space-y-4 p-5 sm:p-6">
          <div>
            <h2 className="font-semibold text-slate-900">Notification preferences</h2>
            <p className="mt-1 text-sm text-slate-500">Choose which in-app alerts you want. Saved to your account.</p>
          </div>
          <ul className="divide-y divide-slate-100">
            {NOTIF_PREF_META.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{item.label}</p>
                  <p className="text-xs text-slate-500">{item.hint}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs[item.key]}
                  aria-label={item.label}
                  onClick={() => setPrefs((p) => ({ ...p, [item.key as NotifPrefKey]: !p[item.key] }))}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                    prefs[item.key] ? "bg-brand-600" : "bg-slate-200"
                  }`}
                >
                  <span
                    className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${
                      prefs[item.key] ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn-primary w-full sm:w-auto" disabled={prefsBusy} onClick={savePrefs}>
            {prefsBusy ? "Saving…" : "Save preferences"}
          </button>
        </section>

        {isClient && (
          <TemplateEditor
            title="Invite message templates"
            description="Quick notes you can add when inviting a professional to a job."
            noun="invite"
            idPrefix="tpl"
            value={mergeInviteTemplates(user.inviteTemplates)}
            defaults={DEFAULT_INVITE_STARTERS}
            placeholder="Message body for inviting a pro…"
            onSave={(items) => updateProfile({ inviteTemplates: items })}
          />
        )}

        {isClient && (
          <TemplateEditor
            title="Counter-offer note templates"
            description="Notes you can send when asking a professional to revise a quote."
            noun="note"
            idPrefix="ho-ctr"
            value={mergeHomeownerCounterNotes(user.homeownerCounterTemplates)}
            defaults={DEFAULT_HOMEOWNER_COUNTER_NOTES}
            placeholder="Note shown when you request a revised quote…"
            onSave={(items) => updateProfile({ homeownerCounterTemplates: items })}
          />
        )}

        {isClient && (
          <section className="card space-y-4 p-5 sm:p-6">
            <div>
              <h2 className="font-semibold text-slate-900">Named job templates</h2>
              <p className="mt-1 text-sm text-slate-500">
                Jobs you saved by name. Apply them when posting a new job.
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
                      <p className="truncate text-xs text-slate-500">{tpl.title}</p>
                    </div>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={namedBusy}
                      onClick={async () => {
                        setNamedBusy(true);
                        try {
                          await updateProfile({ namedJobTemplates: deleteNamedJobTemplate(namedJobs, tpl.id) });
                          success("Template removed");
                        } catch (err) {
                          error(message(err, "Couldn't remove template"));
                        } finally {
                          setNamedBusy(false);
                        }
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {isPro && (
          <TemplateEditor
            title="Counter-offer reply templates"
            description="Replies you can use when a client asks you to revise a quote."
            noun="reply"
            idPrefix="ctr"
            value={mergeCounterTemplates(user.counterTemplates)}
            defaults={DEFAULT_COUNTER_STARTERS}
            placeholder="Reply to a client's counter-offer…"
            onSave={(items) => updateProfile({ counterTemplates: items })}
          />
        )}

        {isPro && (
          <TemplateEditor
            title="Intro / first-message templates"
            description="Openers you can send in the job chat once you're hired."
            noun="intro"
            idPrefix="intro"
            value={mergeIntroTemplates(user.introTemplates)}
            defaults={DEFAULT_INTRO_STARTERS}
            placeholder="First message to a client…"
            onSave={(items) => updateProfile({ introTemplates: items })}
          />
        )}

        {isPro && (
          <section className="card space-y-4 p-5 sm:p-6">
            <div>
              <h2 className="font-semibold text-slate-900">Viewed-but-no-reply nudge</h2>
              <p className="mt-1 text-sm text-slate-500">
                Hours after a client views your revised quote before you get a reminder (default 4).
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
              <button type="button" className="btn-primary" disabled={nudgeBusy} onClick={saveNudge}>
                {nudgeBusy ? "Saving…" : "Save nudge hours"}
              </button>
            </div>
          </section>
        )}

        <form onSubmit={onChangePassword} className="card space-y-4 p-5 sm:p-6" aria-labelledby="pw-title">
          <div>
            <h2 id="pw-title" className="font-semibold text-slate-900">
              Password
            </h2>
            <p className="mt-1 text-sm text-slate-500">Changing it signs you out on your other devices.</p>
          </div>
          <div>
            <label className="label" htmlFor="current-password">
              Current password
            </label>
            <input
              id="current-password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="settings-new-password">
              New password
            </label>
            <input
              id="settings-new-password"
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={10}
              maxLength={128}
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">At least 10 characters.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary" disabled={pwBusy}>
              {pwBusy ? "Saving…" : "Change password"}
            </button>
            <button type="button" className="btn-secondary" onClick={onLogoutEverywhere}>
              Sign out on all devices
            </button>
          </div>
        </form>

        {user.role !== "ADMIN" && (
          <form
            onSubmit={onDeleteAccount}
            className="card space-y-4 border-rose-200 p-5 sm:p-6"
            aria-labelledby="delete-title"
          >
            <div>
              <h2 id="delete-title" className="font-semibold text-rose-800">
                Delete account
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Removes your profile, contact details, photos and saved templates. Finished jobs and reviews stay
                on record without your name. You can't do this while a job is in progress.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="delete-password">
                Confirm with your password
              </label>
              <input
                id="delete-password"
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-danger" disabled={deleteBusy}>
              {deleteBusy ? "Deleting…" : "Delete my account"}
            </button>
          </form>
        )}
      </div>
    </Shell>
  );
}
