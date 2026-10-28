import { useEffect, useState } from "react";
import clsx from "clsx";
import { listChatThreads, type ChatThread } from "../api/extras";
import { JobChat } from "./JobChat";
import { t, tf } from "../lib/i18n";

type Props = {
  jobId: string;
  /** Preselect a pro's thread (e.g. from a notification link ?chat=<id>). */
  initialProId?: string;
  hiredProId?: string;
};

/** Client view: one private conversation per professional who bid on (or was hired for) the job. */
export function JobConversations({ jobId, initialProId, hiredProId }: Props) {
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [selected, setSelected] = useState<string | undefined>(initialProId || hiredProId);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      listChatThreads(jobId)
        .then((r) => {
          if (cancelled) return;
          setThreads(r.threads);
          setSelected((cur) => cur || hiredProId || r.threads[0]?.tradespersonId);
        })
        // A failed poll keeps what's on screen (and the open chat's unsent text) (fe-logic MED 14).
        .catch(() => !cancelled && setThreads((prev) => prev ?? []));
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId, hiredProId]);

  if (threads === null) return null;
  if (!threads.length) {
    return (
      <div className="card p-4 text-sm text-slate-500">
        {t("Messages open once a professional bids. Each professional gets a private conversation with you.")}
      </div>
    );
  }

  const current = threads.find((th) => th.tradespersonId === selected) || threads[0];
  return (
    <section className="space-y-2">
      {threads.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("Conversations")}>
          {threads.map((th) => (
            <button
              key={th.tradespersonId}
              type="button"
              role="tab"
              aria-selected={th.tradespersonId === current.tradespersonId}
              onClick={() => setSelected(th.tradespersonId)}
              className={clsx(
                "rounded-full px-3 py-1.5 text-xs font-semibold ring-1",
                th.tradespersonId === current.tradespersonId
                  ? "bg-brand-700 text-white ring-brand-700"
                  : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
              )}
            >
              {th.name || t("Professional")}
              {th.hired ? t(" · hired") : ""}
              {th.unread > 0 && th.tradespersonId !== current.tradespersonId ? tf(" · {unread} new", { unread: th.unread }) : ""}
            </button>
          ))}
        </div>
      )}
      <JobChat
        key={current.tradespersonId}
        jobId={jobId}
        proId={current.tradespersonId}
        title={tf("Messages with {professional}", { professional: current.name || "the professional" })}
      />
    </section>
  );
}
