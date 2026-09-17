import type { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Job, JobStatus } from "../entities/Job";
import { NotificationType } from "../entities/Notification";
import { createNotification } from "../utils/notifications";
import { toJob } from "../serializers";
import {
  assertAwardedProOrAdmin,
  assertOwnerOrAdmin,
  loadJobContext,
  type JobContext,
} from "../policies/jobPolicy";
import { viewer } from "./jobController";
import { badRequest, conflict } from "../http/errors";

const ACTIVE: JobStatus[] = [JobStatus.AWARDED, JobStatus.IN_PROGRESS, JobStatus.PENDING_CONFIRMATION, JobStatus.COMPLETED];

function assertActive(ctx: JobContext) {
  if (!ACTIVE.includes(ctx.job.status)) {
    throw conflict("Recurring packages are available on awarded, in-progress or completed jobs", "INVALID_STATUS");
  }
}

async function saveProposal(ctx: JobContext, proposal: Job["amcProposal"]) {
  await AppDataSource.getRepository(Job).update({ id: ctx.job.id }, { amcProposal: proposal });
  return AppDataSource.getRepository(Job).findOneOrFail({ where: { id: ctx.job.id } });
}

const statusFor = (action: string) =>
  action === "accept" ? ("accepted" as const) : action === "decline" ? ("declined" as const) : ("countered" as const);

export async function proposeAmc(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertAwardedProOrAdmin(ctx, viewer(req), "Only the hired professional can propose a recurring package");
  assertActive(ctx);
  if (ctx.job.amcProposal?.status === "requested") {
    throw badRequest("The client already requested a package — reply to their request first", "CLIENT_REQUEST_OPEN");
  }
  const b = req.valid.body;
  const job = await saveProposal(ctx, {
    status: "proposed",
    cadence: b.cadence,
    packageLabel: b.packageLabel,
    amountMin: b.amountMin,
    ...(b.amountMax != null ? { amountMax: b.amountMax } : {}),
    ...(b.unit ? { unit: b.unit } : {}),
    ...(b.note ? { note: b.note } : {}),
    proposedByUserId: req.user!.id,
    proposedAt: new Date().toISOString(),
  });
  await createNotification({
    userId: ctx.job.homeownerId,
    type: NotificationType.JOB_STATUS,
    title: "Recurring package proposal",
    body: `${b.packageLabel} (${b.cadence}) proposed on "${ctx.job.title}". Reply on the job.`,
    link: `/client/jobs/${ctx.job.id}`,
    meta: { jobId: ctx.job.id, amc: true },
  });
  return res.json({ job: toJob(job, "private"), message: "Recurring package proposal sent" });
}

export async function replyAmc(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertOwnerOrAdmin(ctx, viewer(req), "Only the client can reply to this proposal");
  assertActive(ctx);
  const existing = ctx.job.amcProposal;
  if (!existing || existing.status !== "proposed") throw badRequest("No open proposal to reply to", "NO_PROPOSAL");
  const b = req.valid.body;
  const status = statusFor(b.action);
  const job = await saveProposal(ctx, {
    ...existing,
    status,
    replyNote: b.replyNote ?? existing.replyNote ?? null,
    ...(b.replyCadence ? { replyCadence: b.replyCadence } : {}),
    repliedAt: new Date().toISOString(),
  });
  if (ctx.acceptedProId) {
    await createNotification({
      userId: ctx.acceptedProId,
      type: NotificationType.JOB_STATUS,
      title: status === "accepted" ? "Recurring package accepted" : status === "declined" ? "Recurring package declined" : "Client replied to your package",
      body: `The client replied to your recurring package on "${ctx.job.title}".`,
      link: `/professional/jobs/${ctx.job.id}`,
      meta: { jobId: ctx.job.id, amc: true, action: b.action },
    });
  }
  return res.json({ job: toJob(job, "private"), message: `Proposal ${status}` });
}

export async function requestAmc(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertOwnerOrAdmin(ctx, viewer(req), "Only the client can request a recurring package");
  assertActive(ctx);
  const existing = ctx.job.amcProposal;
  if (existing && (existing.status === "proposed" || existing.status === "requested")) {
    throw badRequest("A proposal or request is already open — reply or wait", "ALREADY_OPEN");
  }
  const b = req.valid.body;
  const job = await saveProposal(ctx, {
    status: "requested",
    cadence: b.cadence,
    packageLabel: b.packageLabel,
    amountMin: b.amountMin,
    ...(b.amountMax != null ? { amountMax: b.amountMax } : {}),
    ...(b.unit ? { unit: b.unit } : {}),
    ...(b.note ? { note: b.note } : {}),
    proposedByUserId: req.user!.id,
    proposedAt: new Date().toISOString(),
  });
  if (ctx.acceptedProId) {
    await createNotification({
      userId: ctx.acceptedProId,
      type: NotificationType.JOB_STATUS,
      title: "Client requested a recurring package",
      body: `${b.packageLabel} (${b.cadence}) requested on "${ctx.job.title}". Reply on the job.`,
      link: `/professional/jobs/${ctx.job.id}`,
      meta: { jobId: ctx.job.id, amc: true, action: "request" },
    });
  }
  return res.json({ job: toJob(job, "private"), message: "Recurring package request sent" });
}

export async function replyAmcRequest(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertAwardedProOrAdmin(ctx, viewer(req), "Only the hired professional can reply to this request");
  assertActive(ctx);
  const existing = ctx.job.amcProposal;
  if (!existing || existing.status !== "requested") throw badRequest("No open request to reply to", "NO_REQUEST");
  const b = req.valid.body;
  const amountMin = b.amountMin != null ? Math.round(b.amountMin) : existing.amountMin;
  let amountMax = b.amountMax != null ? Math.round(b.amountMax) : existing.amountMax;
  if (amountMax != null && amountMax < amountMin) amountMax = null;
  const status = statusFor(b.action);
  const job = await saveProposal(ctx, {
    ...existing,
    status,
    packageLabel: b.packageLabel || existing.packageLabel,
    amountMin,
    amountMax: amountMax ?? null,
    unit: b.unit || existing.unit || null,
    cadence: b.cadence || existing.cadence,
    replyNote: b.replyNote ?? existing.replyNote ?? null,
    ...(b.replyCadence ? { replyCadence: b.replyCadence } : {}),
    repliedAt: new Date().toISOString(),
  });
  await createNotification({
    userId: ctx.job.homeownerId,
    type: NotificationType.JOB_STATUS,
    title: status === "accepted" ? "Recurring request accepted" : status === "declined" ? "Recurring request declined" : "Professional countered your request",
    body: `Your professional replied to the recurring request on "${ctx.job.title}".`,
    link: `/client/jobs/${ctx.job.id}`,
    meta: { jobId: ctx.job.id, amc: true, action: b.action },
  });
  return res.json({ job: toJob(job, "private"), message: `Request ${status}` });
}
