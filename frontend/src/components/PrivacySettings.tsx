import { useEffect, useState } from "react";
import { Download, ShieldOff } from "lucide-react";
import { downloadMyData, listBlocks, unblockUser, type BlockedUser } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "./Toast";
import { roleLabel } from "../lib/format";

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message) || fallback;

/** Email opt-out, data download and the blocked-users list (Settings). */
export function PrivacySettings() {
  const { user, updateProfile } = useAuth();
  const { success, error } = useToast();
  const [emailBusy, setEmailBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [blocks, setBlocks] = useState<BlockedUser[] | null>(null);
  const [blocksErr, setBlocksErr] = useState(false);
  const canBlock = user?.role === "HOMEOWNER" || user?.role === "TRADESPERSON";

  useEffect(() => {
    if (!canBlock) return;
    let live = true;
    listBlocks()
      .then((r) => live && setBlocks(r.blocks))
      .catch(() => live && setBlocksErr(true));
    return () => {
      live = false;
    };
  }, [canBlock]);

  if (!user) return null;
  const emailOn = user.emailNotifications !== false;

  async function toggleEmail() {
    setEmailBusy(true);
    try {
      await updateProfile({ emailNotifications: !emailOn });
      success(emailOn ? "Email updates turned off" : "Email updates turned on");
    } catch (err) {
      error(message(err, "Couldn't save"));
    } finally {
      setEmailBusy(false);
    }
  }

  async function onExport() {
    setExportBusy(true);
    try {
      await downloadMyData();
      success("Your data download has started");
    } catch (err) {
      error(message(err, "Couldn't prepare your data"));
    } finally {
      setExportBusy(false);
    }
  }

  async function onUnblock(b: BlockedUser) {
    try {
      await unblockUser(b.userId);
      setBlocks((list) => (list ?? []).filter((x) => x.userId !== b.userId));
      success(`${b.name} unblocked`);
    } catch (err) {
      error(message(err, "Couldn't unblock"));
    }
  }

  return (
    <>
      <section className="card space-y-3 p-5 sm:p-6" aria-labelledby="email-title">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="email-title" className="font-semibold text-slate-900">Email updates</h2>
            <p className="mt-1 text-sm text-slate-500">
              New bids, hiring, job progress and disputes, sent to {user.email}
              {user.emailVerified === false ? " once it's verified" : ""}. Account and security emails always go out.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={emailOn}
            aria-label="Email updates"
            disabled={emailBusy}
            onClick={toggleEmail}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${emailOn ? "bg-brand-600" : "bg-slate-200"}`}
          >
            <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${emailOn ? "translate-x-5" : ""}`} />
          </button>
        </div>
      </section>

      {canBlock && (
        <section className="card space-y-3 p-5 sm:p-6" aria-labelledby="blocked-title">
          <div>
            <h2 id="blocked-title" className="font-semibold text-slate-900">Blocked people</h2>
            <p className="mt-1 text-sm text-slate-500">
              Blocked people can't bid on your jobs, invite you or message you, and you can't contact them.
            </p>
          </div>
          {blocksErr ? (
            <p className="text-sm text-rose-700">Couldn't load your blocked list.</p>
          ) : blocks === null ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : blocks.length === 0 ? (
            <p className="text-sm text-slate-500" data-testid="no-blocks">You haven't blocked anyone.</p>
          ) : (
            <ul className="divide-y divide-slate-100" data-testid="blocked-list">
              {blocks.map((b) => (
                <li key={b.userId} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate text-sm">
                    <span className="font-medium text-slate-900">{b.name}</span>{" "}
                    <span className="text-slate-500">· {roleLabel(b.role)}</span>
                  </span>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => onUnblock(b)}>
                    <ShieldOff className="h-4 w-4" aria-hidden /> Unblock
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card space-y-3 p-5 sm:p-6" aria-labelledby="data-title">
        <div>
          <h2 id="data-title" className="font-semibold text-slate-900">Your data</h2>
          <p className="mt-1 text-sm text-slate-500">
            Download everything FixLocal holds about you (profile, jobs, bids, messages, reviews, payments) as a JSON file.
          </p>
        </div>
        <button type="button" className="btn-secondary w-full sm:w-auto" onClick={onExport} disabled={exportBusy}>
          <Download className="h-4 w-4" aria-hidden /> {exportBusy ? "Preparing…" : "Download my data"}
        </button>
      </section>
    </>
  );
}
