import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCheck } from "lucide-react";
import clsx from "clsx";
import { Shell } from "../components/Shell";
import { Spinner } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import { useToast } from "../components/Toast";
import {
  listNotificationsPage,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from "../api/extras";
import { NOTIFICATION_GROUPS, NOTIFICATIONS_CHANGED, dayLabel, notificationHref } from "../lib/notifications";
import { t, tf } from "../lib/i18n";
import { useRequestGuard } from "../lib/useQuery";
import { errorText } from "../lib/apiErrors";
import { isAbort } from "../api/client";

import { fmtTime } from "../lib/format";
const PAGE = 20;

export function NotificationsPage() {
  const { error } = useToast();
  const [group, setGroup] = useState("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);

  const types = NOTIFICATION_GROUPS.find((g) => g.key === group)?.types ?? [];

  // Every load belongs to one filter. Changing the filter aborts the old request, and a slow
  // answer (or a "load more") for the previous filter is dropped instead of mixed in (fe-logic MED 15).
  const begin = useRequestGuard();
  const load = useCallback(
    async (before?: string) => {
      const { signal, isCurrent } = begin();
      const r = await listNotificationsPage({ unread: unreadOnly, types, before, limit: PAGE }, signal);
      if (!isCurrent()) return false;
      setTotal(r.total);
      setUnreadCount(r.unreadCount);
      setItems((xs) => (before ? [...xs, ...r.notifications] : r.notifications));
      return true;
    },
    // `types` is derived from `group`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unreadOnly, group, begin]
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    setItems([]);
    load()
      .then((done) => {
        if (done && live) setLoading(false);
      })
      .catch((e: unknown) => {
        if (!live || isAbort(e)) return;
        error(errorText(e, "Couldn't load notifications"));
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [load, error]);

  async function loadMore() {
    setMore(true);
    try {
      await load(items[items.length - 1]?.createdAt);
    } catch (e) {
      if (!isAbort(e)) error(errorText(e, "Couldn't load more notifications"));
    } finally {
      setMore(false);
    }
  }

  async function open(n: Notification) {
    if (n.read) return;
    setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    setUnreadCount((c) => Math.max(0, c - 1));
    await markNotificationRead(n.id).catch(() => undefined);
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
  }

  async function markAll() {
    try {
      await markAllNotificationsRead();
      setItems((xs) => (unreadOnly ? [] : xs.map((x) => ({ ...x, read: true }))));
      setUnreadCount(0);
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
    } catch (e) {
      error(errorText(e));
    }
  }

  let lastDay = "";
  return (
    <Shell
      title={t("Notifications")}
      subtitle={unreadCount ? tf("{unreadCount} unread", { unreadCount }) : t("You're all caught up")}
      actions={
        <button type="button" className="btn-secondary btn-sm" onClick={markAll} disabled={!unreadCount}>
          <CheckCheck className="h-4 w-4" aria-hidden /> {t("Mark all read")}
        </button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("Show")}>
          {NOTIFICATION_GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              aria-pressed={group === g.key}
              onClick={() => setGroup(g.key)}
              className={clsx(
                "rounded-full border px-3 py-1.5 text-sm",
                group === g.key ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white text-slate-700"
              )}
            >
              {t(g.label)}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          {t("Unread only")}
        </label>
      </div>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title={t("Nothing here")} description={unreadOnly ? t("No unread notifications in this view.") : t("Notifications about your jobs, bids and messages show up here.")} />
      ) : (
        <div className="card overflow-hidden">
          <ul>
            {items.map((n) => {
              const day = dayLabel(n.createdAt);
              const heading = day !== lastDay ? day : null;
              lastDay = day;
              return (
                <li key={n.id}>
                  {heading && (
                    <h2 className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {heading}
                    </h2>
                  )}
                  <Link
                    to={notificationHref(n)}
                    onClick={() => open(n)}
                    className={clsx(
                      "flex gap-3 border-b border-slate-100 px-4 py-3 no-underline hover:bg-slate-50",
                      !n.read && "bg-brand-50"
                    )}
                  >
                    <span
                      className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-brand-700")}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-900">
                        {t(n.title)}
                        {!n.read && <span className="sr-only"> {t("(unread)")}</span>}
                      </span>
                      <span className="mt-0.5 block text-sm text-slate-600">{n.body}</span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {fmtTime(n.createdAt)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {items.length < total && (
            <div className="p-3 text-center">
              <button type="button" className="btn-secondary btn-sm" onClick={loadMore} disabled={more}>
                {more ? t("Loading…") : tf("Show older ({items} more)", { items: total - items.length })}
              </button>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
