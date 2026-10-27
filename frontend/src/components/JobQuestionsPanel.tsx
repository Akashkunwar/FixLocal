import { FormEvent, useEffect, useState } from "react";
import { HelpCircle } from "lucide-react";
import { ApiError } from "../api/client";
import { answerJobQuestion, askJobQuestion, deleteJobQuestion, listJobQuestions, type JobQuestion } from "../api/jobs";
import { useI18n } from "../lib/i18n";
import { fmtDate } from "../lib/format";

/**
 * Public questions before bidding. Professionals ask (shown to other pros without their name);
 * the client answers once and every pro sees it, which saves repeating it in each chat.
 */
export function JobQuestionsPanel({ jobId }: { jobId: string }) {
  const { t } = useI18n();
  const [data, setData] = useState<{ questions: JobQuestion[]; canAsk: boolean; canAnswer: boolean } | null>(null);
  const [text, setText] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    listJobQuestions(jobId, ctrl.signal)
      .then(setData)
      .catch(() => {
        /* hidden when the viewer can't see the job's questions */
      });
    return () => ctrl.abort();
  }, [jobId]);

  if (!data || (!data.canAsk && !data.canAnswer && data.questions.length === 0)) return null;

  const fail = (err: unknown) => setMsg({ ok: false, text: err instanceof ApiError ? err.message : t("Something went wrong. Try again.") });
  const replace = (q: JobQuestion) => setData((d) => (d ? { ...d, questions: d.questions.map((x) => (x.id === q.id ? q : x)) } : d));

  async function onAsk(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await askJobQuestion(jobId, text.trim());
      setData((d) => (d ? { ...d, questions: [...d.questions, r.question] } : d));
      setText("");
      setMsg({ ok: true, text: t("Question sent. The client gets a notification.") });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function onAnswer(e: FormEvent, q: JobQuestion) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await answerJobQuestion(jobId, q.id, (answers[q.id] ?? "").trim());
      replace(r.question);
      setAnswers((a) => ({ ...a, [q.id]: "" }));
      setMsg({ ok: true, text: t("Answer posted. Every professional viewing this job can see it.") });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(q: JobQuestion) {
    setBusy(true);
    setMsg(null);
    try {
      await deleteJobQuestion(jobId, q.id);
      setData((d) => (d ? { ...d, questions: d.questions.filter((x) => x.id !== q.id) } : d));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="questions" className="card scroll-mt-24 space-y-4 p-5 sm:p-6" aria-labelledby="questions-title">
      <div>
        <h2 id="questions-title" className="flex items-center gap-2 font-semibold text-slate-900">
          <HelpCircle className="h-5 w-5 text-brand-700" aria-hidden /> {t("Questions about this job")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {data.canAnswer
            ? t("Professionals can ask before they bid. Your answers are shown to every professional who views this job.")
            : t("Ask the client before you bid. Questions and answers are visible to other professionals, but not your name.")}
        </p>
      </div>

      {data.questions.length === 0 ? (
        <p className="text-sm text-slate-500">{t("No questions yet.")}</p>
      ) : (
        <ul className="space-y-3">
          {data.questions.map((q) => (
            <li key={q.id} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200" data-testid="job-question">
              <p className="text-xs text-slate-500">
                {q.askedByYou ? t("You asked") : q.askerName ?? t("A professional")} · {fmtDate(q.createdAt)}
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900 break-words">{q.question}</p>
              {q.answer ? (
                <p className="mt-2 border-l-4 border-brand-200 pl-3 text-sm text-slate-700 break-words">
                  <span className="font-semibold">{t("Client:")}</span> {q.answer}
                </p>
              ) : (
                !data.canAnswer && <p className="mt-2 text-xs text-slate-500">{t("Waiting for the client's answer.")}</p>
              )}
              {data.canAnswer && (
                <form onSubmit={(e) => onAnswer(e, q)} className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <label htmlFor={`answer-${q.id}`} className="sr-only">
                    {t("Your answer")}
                  </label>
                  <input
                    id={`answer-${q.id}`}
                    className="input flex-1"
                    maxLength={1000}
                    placeholder={q.answer ? t("Edit your answer") : t("Type your answer")}
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <button type="submit" className="btn-primary btn-sm" disabled={busy || !(answers[q.id] ?? "").trim()}>
                      {q.answer ? t("Update") : t("Answer")}
                    </button>
                    <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => onDelete(q)}>
                      {t("Remove")}
                    </button>
                  </div>
                </form>
              )}
              {!data.canAnswer && q.askedByYou && !q.answer && (
                <button type="button" className="btn-ghost btn-sm mt-1" disabled={busy} onClick={() => onDelete(q)}>
                  {t("Withdraw question")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {data.canAsk && (
        <form onSubmit={onAsk} className="space-y-2">
          <label htmlFor="ask-question" className="label">
            {t("Ask a question")}
          </label>
          <textarea
            id="ask-question"
            className="input min-h-20"
            maxLength={500}
            placeholder={t("e.g. Which floor is it on, and is there a lift?")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="text-xs text-slate-500">{t("Don't share phone numbers or emails here. They unlock in chat once you're hired.")}</p>
          <button type="submit" className="btn-primary" disabled={busy || !text.trim()}>
            {t("Send question")}
          </button>
        </form>
      )}

      {msg && (
        <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
