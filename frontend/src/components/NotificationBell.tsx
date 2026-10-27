import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { Link } from "react-router-dom";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from "../api/extras";
import { fmtDateTime } from "../lib/format";
import { openSse } from "../lib/sse";
import { NOTIFICATIONS_CHANGED, notificationHref } from "../lib/notifications";
import clsx from "clsx";
import { t } from "../lib/i18n";
import { useDialogFocus } from "./ui/Dialog";
import { useRequestGuard } from "../lib/useQuery";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [live, setLive] = useState(false);
  const seenIds = useRef(new Set<string>());
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const sseOk = useRef(false);
  const begin = useRequestGuard();
  // Escape closes the panel and focus goes back to the bell (ux MED 8). Not a modal: no trap.
  useDialogFocus(open, panelRef, () => setOpen(false), { trap: false });

  const load = useCallback(async () => {
    const { signal, isCurrent } = begin();
    try {
      const r = await listNotifications(false, signal);
      if (!isCurrent()) return;
      r.notifications.forEach((n) => seenIds.current.add(n.id));
      setItems(r.notifications);
      setUnread(r.unreadCount);
    } catch {
      /* ignore: the next poll or live event tries again */
    }
  }, [begin]);


  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    load();
    const sse = openSse("/api/notifications/stream", {
      onOpen: () => {
        sseOk.current = true;
        setLive(true);
        load(); // (re)connected: catch up on anything sent while the stream was down (fe-logic LOW 19)
      },
      onError: () => {
        sseOk.current = false;
        setLive(false);
      },
      onEvent: (event, data) => {
        if (event !== "notification") return;
        const payload = data as { notification?: Notification };
        if (payload?.notification) {
          const n = payload.notification;
          // A repeated event (reconnect, two streams) must not count the same notification twice.
          if (seenIds.current.has(n.id)) return;
          seenIds.current.add(n.id);
          setItems((xs) => [n, ...xs.filter((x) => x.id !== n.id)].slice(0, 30));
          if (!n.read) setUnread((u) => u + 1);
        } else {
          load();
        }
      },
    });
    return () => sse.close();
  }, [load]);

  useEffect(() => {
    // Fall back to polling when SSE is down; slow safety poll when live.
    const ms = live ? (open ? 45000 : 90000) : open ? 4000 : 15000;
    const timer = window.setInterval(() => load(), ms);
    return () => clearInterval(timer);
  }, [open, live, load]);

  useEffect(() => {
    // The notification centre page marks things read; keep the badge in step.
    const reload = () => load();
    window.addEventListener(NOTIFICATIONS_CHANGED, reload);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, reload);
  }, [load]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function onOpen() {
    setOpen((o) => !o);
    load();
  }

  async function onClickItem(n: Notification) {
    if (!n.read) {
      await markNotificationRead(n.id).catch(() => {});
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
    }
    setOpen(false);
  }

  async function markAll() {
    await markAllNotificationsRead().catch(() => {});
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    setUnread(0);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="relative rounded-xl p-2.5 text-slate-600 hover:bg-slate-100 touch-target"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={onOpen}
        title={t("Notifications")}
      >
        <Bell className="h-5 w-5" aria-hidden />
        <span className="sr-only">{t("Notifications")}</span>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
            <span className="sr-only"> {t("unread")}</span>
          </span>
        )}
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={t("Notifications")}
          tabIndex={-1}
          className="fixed inset-x-3 top-16 z-50 max-h-[70vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lift sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80 sm:max-h-none"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold">{t("Notifications")}</span>
            {unread > 0 && (
              <button type="button" className="text-xs text-brand-700" onClick={markAll}>
                {t("Mark all read")}
              </button>
            )}
          </div>
          <ul className="max-h-[min(20rem,55vh)] overflow-y-auto">
            {items.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-slate-500">{t("You're all caught up")}</li>
            )}
            {items.map((n) => (
              <li key={n.id}>
                <Link
                  to={notificationHref(n)}
                  onClick={() => onClickItem(n)}
                  className={clsx(
                    "block px-4 py-3 hover:bg-slate-50 border-b border-slate-50",
                    !n.read && "bg-brand-50/40"
                  )}
                >
                  <p className="text-sm font-medium text-slate-900">{t(n.title)}</p>
                  <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{n.body}</p>
                  <p className="mt-1 text-[11px] text-slate-500">{fmtDateTime(n.createdAt)}</p>
                </Link>
              </li>
            ))}
          </ul>
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-slate-100 px-4 py-3 text-center text-sm font-medium text-brand-700"
          >
            {t("See all notifications")}
          </Link>
        </div>
      )}
    </div>
  );
}
