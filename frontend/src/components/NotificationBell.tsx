import { useEffect, useRef, useState } from "react";
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
import clsx from "clsx";

function inviteAwareLink(n: Notification): string {
  const meta = n.meta || {};
  if (meta.invite === true && typeof meta.jobId === "string") {
    return `/professional/jobs/${meta.jobId}?invite=1#bid-form`;
  }
  if (meta.inviteDeclined === true && typeof meta.jobId === "string") {
    return `/client/jobs/${meta.jobId}`;
  }
  if (
    meta.quoteRevised === true &&
    typeof meta.jobId === "string" &&
    typeof meta.bidId === "string"
  ) {
    return `/client/jobs/${meta.jobId}?bid=${meta.bidId}#bid-${meta.bidId}`;
  }
  if (meta.counterOffer === true && typeof meta.jobId === "string") {
    return `/professional/jobs/${meta.jobId}?counter=1#bid-form`;
  }
  if (meta.quoteViewed === true && typeof meta.jobId === "string") {
    return `/professional/jobs/${meta.jobId}`;
  }
  return n.link || "#";
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [live, setLive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const sseOk = useRef(false);

  async function load() {
    try {
      const r = await listNotifications();
      setItems(r.notifications);
      setUnread(r.unreadCount);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    load();
    const sse = openSse("/api/notifications/stream", {
      onOpen: () => {
        sseOk.current = true;
        setLive(true);
      },
      onError: () => {
        sseOk.current = false;
        setLive(false);
      },
      onEvent: (event, data) => {
        if (event !== "notification") return;
        const payload = data as { notification?: Notification };
        if (payload?.notification) {
          setItems((xs) => {
            if (xs.some((x) => x.id === payload.notification!.id)) return xs;
            return [payload.notification!, ...xs].slice(0, 30);
          });
          setUnread((u) => u + 1);
        } else {
          load();
        }
      },
    });
    return () => sse.close();
  }, []);

  useEffect(() => {
    // Fall back to polling when SSE is down; slow safety poll when live.
    const ms = live ? (open ? 45000 : 90000) : open ? 4000 : 15000;
    const t = window.setInterval(() => load(), ms);
    return () => clearInterval(t);
  }, [open, live]);

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
        aria-label="Notifications"
        onClick={onOpen}
        title={live ? "Live notifications (SSE)" : "Notifications (polling)"}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-16 z-50 max-h-[70vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lift sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80 sm:max-h-none">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold">
              Notifications
              <span className="ml-2 text-[10px] font-normal text-slate-400">
                {live ? "live" : "polling"}
              </span>
            </span>
            {unread > 0 && (
              <button type="button" className="text-xs text-brand-700" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[min(20rem,55vh)] overflow-y-auto">
            {items.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-slate-500">You're all caught up</li>
            )}
            {items.map((n) => (
              <li key={n.id}>
                <Link
                  to={inviteAwareLink(n)}
                  onClick={() => onClickItem(n)}
                  className={clsx(
                    "block px-4 py-3 hover:bg-slate-50 border-b border-slate-50",
                    !n.read && "bg-brand-50/40"
                  )}
                >
                  <p className="text-sm font-medium text-slate-900">{n.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{n.body}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{fmtDateTime(n.createdAt)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
