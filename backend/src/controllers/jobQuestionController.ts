import type { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { JobStatus } from "../entities/Job";
import { JobQuestion } from "../entities/JobQuestion";
import { NotificationType } from "../entities/Notification";
import { UserRole } from "../entities/User";
import { conflict, forbidden, notFound } from "../http/errors";
import { assertJobAccess, isAdmin, isOwner, loadJobContext, type JobContext, type Viewer } from "../policies/jobPolicy";
import { assertNoContactInfo } from "../domain/contactInfo";
import { createNotification } from "../utils/notifications";
import { isBlockedBetween } from "../utils/blocks";
import { viewer } from "./jobController";

/** Open (unanswered) questions one professional may have on a job at a time. */
export const MAX_OPEN_QUESTIONS_PER_PRO = 3;

const repo = () => AppDataSource.getRepository(JobQuestion);

function toQuestion(q: JobQuestion, ctx: JobContext, v: Viewer) {
  const seesAsker = isOwner(ctx, v) || isAdmin(v);
  return {
    id: q.id,
    question: q.question,
    answer: q.answer ?? null,
    answeredAt: q.answeredAt ?? null,
    createdAt: q.createdAt,
    askedByYou: !!q.askerId && q.askerId === v.id,
    askerName: seesAsker ? (q.asker?.name ?? "Professional") : null,
    askerId: seesAsker ? q.askerId : null,
  };
}

const assertNoContact = (text: string) => assertNoContactInfo(text);

export async function listQuestions(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  const v = viewer(req);
  await assertJobAccess(ctx, v);
  const rows = await repo().find({ where: { jobId: ctx.job.id }, relations: ["asker"], order: { createdAt: "ASC" }, take: 100 });
  return res.json({
    questions: rows.map((q) => toQuestion(q, ctx, v)),
    canAsk: v.role === UserRole.TRADESPERSON && ctx.job.status === JobStatus.OPEN,
    canAnswer: isOwner(ctx, v),
  });
}

export async function askQuestion(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  const v = viewer(req);
  if (v.role !== UserRole.TRADESPERSON) throw forbidden("Only professionals can ask about a job");
  await assertJobAccess(ctx, v);
  if (ctx.job.status !== JobStatus.OPEN) throw conflict("Questions close once the job is no longer open", "JOB_NOT_OPEN");
  if (await isBlockedBetween(ctx.job.homeownerId, v.id)) throw forbidden("You can't contact this client");
  const text = String(req.valid.body.question).trim();
  assertNoContact(text);
  const open = await repo()
    .createQueryBuilder("q")
    .where(`q."jobId" = :job AND q."askerId" = :me AND q.answer IS NULL`, { job: ctx.job.id, me: v.id })
    .getCount();
  if (open >= MAX_OPEN_QUESTIONS_PER_PRO) {
    throw conflict(`You can have ${MAX_OPEN_QUESTIONS_PER_PRO} unanswered questions on a job. Wait for the client to reply.`, "TOO_MANY_QUESTIONS");
  }
  const saved = await repo().save(repo().create({ jobId: ctx.job.id, askerId: v.id, question: text }));
  await createNotification({
    userId: ctx.job.homeownerId,
    type: NotificationType.JOB_STATUS,
    title: "New question on your job",
    body: `A professional asked about "${ctx.job.title}": ${text.slice(0, 140)}`,
    link: `/client/jobs/${ctx.job.id}#questions`,
    meta: { jobId: ctx.job.id, questionId: saved.id },
  });
  const full = await repo().findOneOrFail({ where: { id: saved.id }, relations: ["asker"] });
  return res.status(201).json({ question: toQuestion(full, ctx, v) });
}

export async function answerQuestion(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  const v = viewer(req);
  if (!isOwner(ctx, v)) throw forbidden("Only the client who posted this job can answer");
  const q = await repo().findOne({ where: { id: req.valid.params.questionId, jobId: ctx.job.id }, relations: ["asker"] });
  if (!q) throw notFound("Question not found");
  const text = String(req.valid.body.answer).trim();
  assertNoContact(text);
  const first = !q.answer;
  q.answer = text;
  q.answeredAt = new Date();
  await repo().save(q);
  if (first && q.askerId) {
    await createNotification({
      userId: q.askerId,
      type: NotificationType.JOB_STATUS,
      title: "Your question was answered",
      body: `The client answered your question on "${ctx.job.title}".`,
      link: `/professional/jobs/${ctx.job.id}#questions`,
      meta: { jobId: ctx.job.id, questionId: q.id },
    });
  }
  return res.json({ question: toQuestion(q, ctx, v) });
}

/** The client removes an unhelpful question, or the asker withdraws their own. */
export async function deleteQuestion(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  const v = viewer(req);
  const q = await repo().findOne({ where: { id: req.valid.params.questionId, jobId: ctx.job.id } });
  if (!q) throw notFound("Question not found");
  if (!isOwner(ctx, v) && !isAdmin(v) && q.askerId !== v.id) throw forbidden("You can't remove this question");
  await repo().delete({ id: q.id });
  return res.json({ ok: true });
}
