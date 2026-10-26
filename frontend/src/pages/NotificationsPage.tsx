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

  const load = useCallback(
    async (before?: string) => {
      const r = await listNotificationsPage({ unread: unreadOnly, types, before, limit: PAGE });
      setTotal(r.total);
      setUnreadCount(r.unreadCount);
      setItems((xs) => (before ? [...xs, ...r.notifications] : r.notifications));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unreadOnly, group]
  );

  useEffect(() => {
    setLoading(true);
    load()
      .catch((e: Error) => error(e.message))
      .finally(() => setLoading(false));
  }, [load, error]);

  async function loadMore() {
    setMore(true);
    try {
      await load(items[items.length - 1]?.createdAt);
    } catch (e) {
      error((e as Error).message);
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
      error((e as Error).message);
    }
  }

  let lastDay = "";
  return (
    <Shell
      title="Notifications"
      subtitle={unreadCount ? `${unreadCount} unread` : "You're all caught up"}
      actions={
        <button type="button" className="btn-secondary btn-sm" onClick={markAll} disabled={!unreadCount}>
          <CheckCheck className="h-4 w-4" aria-hidden /> Mark all read
        </button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
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
              {g.label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          Unread only
        </label>
      </div>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title="Nothing here" description={unreadOnly ? "No unread notifications in this view." : "Notifications about your jobs, bids and messages show up here."} />
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
                        {n.title}
                        {!n.read && <span className="sr-only"> (unread)</span>}
                      </span>
                      <span className="mt-0.5 block text-sm text-slate-600">{n.body}</span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {new Date(n.createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
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
                {more ? "Loading…" : `Show older (${total - items.length} more)`}
              </button>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
