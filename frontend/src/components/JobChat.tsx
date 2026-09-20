import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  listMessages,
  markThreadRead,
  messageStreamPath,
  sendMessage,
  type ChatMessage,
} from "../api/extras";
import { mediaUrl } from "../api/jobs";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { fmtDateTime, initials, money } from "../lib/format";
import { useToast } from "./Toast";
import { compressImageFiles } from "../lib/compressImage";
import { openSse } from "../lib/sse";
import { FileText, Paperclip, X } from "lucide-react";
import clsx from "clsx";
import { mergeIntroTemplates } from "../lib/introTemplates";

function isImageUrl(url: string) {
  return /\.(png|jpe?g|webp)$/i.test(url.split("?")[0] || "");
}

const POLL_MIN_MS = 3_000;
const POLL_MAX_MS = 60_000;

type Props = {
  jobId: string;
  /** Which professional's conversation (clients and admins). Pros always get their own. */
  proId?: string | null;
  title?: string;
};

export function JobChat({ jobId, proId, title = "Messages" }: Props) {
  const { user } = useAuth();
  const { error } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState(false);
  const [denied, setDenied] = useState(false);
  const [canSend, setCanSend] = useState(true);
  const [showQuote, setShowQuote] = useState(false);
  const [quoteAmount, setQuoteAmount] = useState("");
  const [quoteNotes, setQuoteNotes] = useState("");
  const [quoteFile, setQuoteFile] = useState<File | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sseOk = useRef(false);
  const lastCount = useRef(0);
  const introChips = mergeIntroTemplates(user?.role === "TRADESPERSON" ? user.introTemplates : null);

  /** "ok" | "error" (retry with backoff) | "denied" (stop: this viewer has no access). */
  const load = useCallback(async (): Promise<"ok" | "error" | "denied"> => {
    try {
      const r = await listMessages(jobId, proId);
      setMessages(r.messages);
      setCanSend(r.canSend);
      setDenied(false);
      if (r.messages.length && document.visibilityState === "visible" && user?.role !== "ADMIN") {
        markThreadRead(jobId, proId).catch(() => undefined);
      }
      return "ok";
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404 || e.status === 400)) {
        setDenied(true);
        return "denied";
      }
      return "error";
    }
  }, [jobId, proId, user?.role]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = POLL_MIN_MS;
    setMessages([]);
    lastCount.current = 0;

    const sse = openSse(messageStreamPath(jobId, proId), {
      onOpen: () => {
        sseOk.current = true;
        setLive(true);
        delay = POLL_MIN_MS;
      },
      onError: () => {
        sseOk.current = false;
        setLive(false);
      },
      onDenied: () => setDenied(true),
      onEvent: (event, data) => {
        if (event !== "message") return;
        const payload = data as { message?: ChatMessage };
        if (!payload?.message) {
          void load();
          return;
        }
        setMessages((xs) => (xs.some((m) => m.id === payload.message!.id) ? xs : [...xs, payload.message!]));
        if (payload.message.sender.id !== user?.id && user?.role !== "ADMIN") {
          markThreadRead(jobId, proId).catch(() => undefined);
        }
      },
    });

    // Refused (403/404): stop polling and drop the stream instead of retrying forever.
    const stop = () => {
      stopped = true;
      sse.close();
    };

    // Poll only while the live stream is down: every 3s, backing off to 60s while requests fail.
    const next = (result: "ok" | "error" | "denied") => {
      if (result === "denied") return stop();
      delay = result === "ok" ? POLL_MIN_MS : Math.min(POLL_MAX_MS, delay * 2);
      if (!stopped) timer = setTimeout(poll, sseOk.current ? POLL_MAX_MS : delay);
    };
    const poll = async () => {
      if (stopped) return;
      if (sseOk.current) return next("ok");
      next(await load());
    };

    void load().then(next);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      sse.close();
      sseOk.current = false;
    };
  }, [jobId, proId, load, user?.id, user?.role]);

  // Keep the newest message in view, but only when a message was added (and without scrolling the page).
  useEffect(() => {
    if (messages.length > lastCount.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
    lastCount.current = messages.length;
  }, [messages]);

  async function onPick(list: FileList | null) {
    if (!list?.length) return;
    const picked = Array.from(list).slice(0, 4);
    try {
      const images = picked.filter((f) => f.type.startsWith("image/"));
      const other = picked.filter((f) => !f.type.startsWith("image/"));
      const compressed = images.length ? await compressImageFiles(images) : [];
      setFiles((prev) => [...prev, ...compressed, ...other].slice(0, 4));
    } catch (e) {
      error((e as Error).message || "Could not read that image");
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    const qAmt = Number(quoteAmount);
    const quote =
      showQuote && Number.isFinite(qAmt) && qAmt > 0
        ? { amount: qAmt, notes: quoteNotes || undefined, attachment: quoteFile }
        : undefined;
    if (!body.trim() && !files.length && !quote) return;
    setSending(true);
    try {
      const r = await sendMessage(jobId, body.trim(), files, quote, proId);
      setMessages((xs) => (xs.some((m) => m.id === r.message.id) ? xs : [...xs, r.message]));
      setBody("");
      setFiles([]);
      setQuoteAmount("");
      setQuoteNotes("");
      setQuoteFile(null);
      setShowQuote(false);
    } catch (err) {
      error((err as Error).message || "Could not send");
    } finally {
      setSending(false);
    }
  }

  if (denied) {
    return (
      <div className="card p-4 text-sm text-slate-500" role="status">
        This conversation isn't available to you.
      </div>
    );
  }

  const canQuote = user?.role === "TRADESPERSON";

  return (
    <div className="card flex flex-col overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500">
          {live ? "Live" : "Updating periodically"} · text, images, PDF
          {canQuote ? ", or structured quote" : ""}
        </p>
      </div>
      <div ref={listRef} className="max-h-72 space-y-3 overflow-y-auto bg-slate-50/50 px-4 py-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="py-4 text-center space-y-3">
            <p className="text-sm text-slate-400">No messages yet. Say hello!</p>
            {canQuote && introChips.length > 0 && (
              <div
                className="flex flex-wrap justify-center gap-2 px-2"
                role="group"
                aria-label="Professional intro message templates"
              >
                {introChips.slice(0, 6).map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-brand-50 hover:ring-brand-200"
                    onClick={() => setBody(tpl.body)}
                    title={tpl.body}
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((m) => {
          const mine = m.sender.id === user?.id;
          const attachments = m.attachmentUrls || [];
          return (
            <div key={m.id} className={clsx("flex gap-2", mine && "flex-row-reverse")}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
                {initials(m.sender.name, m.sender.role)}
              </div>
              <div
                className={clsx(
                  "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm",
                  mine ? "bg-brand-700 text-white" : "bg-white border border-slate-200 text-slate-800"
                )}
              >
                <p className={clsx("text-[11px] mb-0.5", mine ? "text-brand-100" : "text-slate-400")}>
                  {m.sender.name || (m.sender.role === "TRADESPERSON" ? "Professional" : "Client")} · {fmtDateTime(m.createdAt)}
                </p>
                {m.quote && (
                  <div
                    className={clsx(
                      "mb-2 rounded-xl px-3 py-2 text-xs",
                      mine ? "bg-brand-800/60" : "bg-amber-50 ring-1 ring-amber-200 text-amber-950"
                    )}
                  >
                    <p className="font-semibold">Quote / estimate · {money(m.quote.amount)}</p>
                    {m.quote.notes && <p className="mt-1 whitespace-pre-wrap opacity-90">{m.quote.notes}</p>}
                    {m.quote.attachmentUrl && (
                      <a
                        href={mediaUrl(m.quote.attachmentUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className={clsx("mt-1 inline-block underline", mine ? "text-brand-100" : "text-brand-700")}
                      >
                        View attachment
                      </a>
                    )}
                  </div>
                )}
                {m.body && m.body !== "(attachment)" && !m.body.startsWith("Quote: ₹") && (
                  <p className="whitespace-pre-wrap">{m.body}</p>
                )}
                {m.body?.startsWith("Quote: ₹") && !m.quote && (
                  <p className="whitespace-pre-wrap">{m.body}</p>
                )}
                {attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {attachments.map((url) =>
                      isImageUrl(url) ? (
                        <a key={url} href={mediaUrl(url)} target="_blank" rel="noreferrer" className="block">
                          <img
                            src={mediaUrl(url)}
                            alt="Attachment"
                            className="h-24 w-24 rounded-lg object-cover border border-white/20"
                          />
                        </a>
                      ) : (
                        <a
                          key={url}
                          href={mediaUrl(url)}
                          target="_blank"
                          rel="noreferrer"
                          className={clsx(
                            "text-xs underline break-all",
                            mine ? "text-brand-100" : "text-brand-700"
                          )}
                        >
                          {(url.split("?")[0].split("/").pop() || "File").endsWith(".pdf") ? "PDF attachment" : "Attachment"}
                        </a>
                      )
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 px-3 pt-2">
          {files.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700"
            >
              {f.name.slice(0, 18)}
              {f.name.length > 18 ? "…" : ""}
              <button
                type="button"
                className="text-slate-400 hover:text-slate-700"
                onClick={() => setFiles((xs) => xs.filter((_, j) => j !== i))}
                aria-label="Remove file"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {canQuote && showQuote && (
        <div className="space-y-2 border-t border-amber-100 bg-amber-50/60 px-3 py-3">
          <p className="text-xs font-semibold text-amber-900">Attach a structured quote</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="input"
              type="number"
              min={1}
              max={10000000}
              aria-label="Quote amount in rupees"
              placeholder="Quote amount (₹)"
              value={quoteAmount}
              onChange={(e) => setQuoteAmount(e.target.value)}
            />
            <input
              className="input"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              aria-label="Quote attachment"
              onChange={(e) => setQuoteFile(e.target.files?.[0] || null)}
            />
          </div>
          <textarea
            className="input"
            rows={2}
            placeholder="Notes (materials, labour breakdown…)"
            value={quoteNotes}
            onChange={(e) => setQuoteNotes(e.target.value)}
          />
        </div>
      )}
      {!canSend ? (
        <p className="border-t border-slate-100 p-3 text-xs text-slate-500">
          This conversation is read-only.
        </p>
      ) : (
      <form onSubmit={onSend} className="flex gap-2 border-t border-slate-100 p-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => onPick(e.target.files)}
        />
        <button
          type="button"
          className="btn-ghost shrink-0 px-2"
          onClick={() => fileRef.current?.click()}
          aria-label="Attach file"
          title="Attach image or PDF"
        >
          <Paperclip className="h-5 w-5" />
        </button>
        {canQuote && (
          <button
            type="button"
            className={clsx("btn-ghost shrink-0 px-2", showQuote && "bg-amber-100 text-amber-900")}
            onClick={() => setShowQuote((v) => !v)}
            aria-label="Add quote"
            title="Attach quote / estimate"
          >
            <FileText className="h-5 w-5" />
          </button>
        )}
        <input
          className="input"
          placeholder="Type a message…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-label="Message"
        />
        <button
          type="submit"
          className="btn-primary shrink-0"
          disabled={
            sending ||
            (!body.trim() &&
              !files.length &&
              !(showQuote && Number(quoteAmount) > 0))
          }
        >
          Send
        </button>
      </form>
      )}
    </div>
  );
}
