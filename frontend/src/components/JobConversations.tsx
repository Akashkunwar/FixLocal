import { useEffect, useState } from "react";
import clsx from "clsx";
import { listChatThreads, type ChatThread } from "../api/extras";
import { JobChat } from "./JobChat";

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
        .catch(() => !cancelled && setThreads([]));
    void load();
    const t = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [jobId, hiredProId]);

  if (threads === null) return null;
  if (!threads.length) {
    return (
      <div className="card p-4 text-sm text-slate-500">
        Messages open once a professional bids. Each professional gets a private conversation with you.
      </div>
    );
  }

  const current = threads.find((t) => t.tradespersonId === selected) || threads[0];
  return (
    <section className="space-y-2">
      {threads.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Conversations">
          {threads.map((t) => (
            <button
              key={t.tradespersonId}
              type="button"
              role="tab"
              aria-selected={t.tradespersonId === current.tradespersonId}
              onClick={() => setSelected(t.tradespersonId)}
              className={clsx(
                "rounded-full px-3 py-1.5 text-xs font-semibold ring-1",
                t.tradespersonId === current.tradespersonId
                  ? "bg-brand-700 text-white ring-brand-700"
                  : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
              )}
            >
              {t.name || "Professional"}
              {t.hired ? " · hired" : ""}
              {t.unread > 0 && t.tradespersonId !== current.tradespersonId ? ` · ${t.unread} new` : ""}
            </button>
          ))}
        </div>
      )}
      <JobChat
        key={current.tradespersonId}
        jobId={jobId}
        proId={current.tradespersonId}
        title={`Messages with ${current.name || "the professional"}`}
      />
    </section>
  );
}
