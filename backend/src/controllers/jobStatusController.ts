import { grantReferralRewards } from "../domain/credits";
import type { Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Job, JobStatus } from "../entities/Job";
import { NotificationType } from "../entities/Notification";
import { createNotification, createNotifications } from "../utils/notifications";
import { toJob } from "../serializers";
import { transitionJob } from "../domain/jobStateMachine";
import { refundMilestones, releaseRemaining } from "../domain/escrow";
import { config } from "../config";
import {
  assertAwardedProOrAdmin,
  isAdmin,
  isAwardedPro,
  isOwner,
  loadJobContext,
} from "../policies/jobPolicy";
import { viewer } from "./jobController";
import { conflict, forbidden } from "../http/errors";
import { revokeThreadStreams } from "../utils/sse";

const jobRepo = () => AppDataSource.getRepository(Job);

export async function startJob(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  if (!isAwardedPro(ctx, viewer(req))) throw forbidden("Only the hired professional can start this job");
  await AppDataSource.transaction((m) => transitionJob(m, ctx.job.id, "start"));
  await createNotification({
    userId: ctx.job.homeownerId,
    type: NotificationType.JOB_STATUS,
    title: "Work started",
    body: `The professional started work on "${ctx.job.title}".`,
    link: `/client/jobs/${ctx.job.id}`,
    meta: { jobId: ctx.job.id, status: JobStatus.IN_PROGRESS },
  });
  const job = await jobRepo().findOneOrFail({ where: { id: ctx.job.id } });
  return res.json({ job: toJob(job, "private") });
}

/** Pro: work is done → waiting for the client. */
export async function markDone(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertAwardedProOrAdmin(ctx, viewer(req));
  await AppDataSource.transaction((m) =>
    transitionJob(m, ctx.job.id, "mark_done", { pendingConfirmationAt: new Date() })
  );
  const days = config().autoConfirmDays;
  await createNotification({
    userId: ctx.job.homeownerId,
    type: NotificationType.JOB_STATUS,
    title: "Please confirm the work is complete",
    body: `The professional marked "${ctx.job.title}" as done. Confirm to release the remaining payment, or open a dispute. It will be confirmed automatically in ${days} day${days === 1 ? "" : "s"}.`,
    link: `/client/jobs/${ctx.job.id}`,
    meta: { jobId: ctx.job.id, status: JobStatus.PENDING_CONFIRMATION },
  });
  const job = await jobRepo().findOneOrFail({ where: { id: ctx.job.id } });
  return res.json({ job: toJob(job, "private"), autoReleased: null });
}

/** Client (or admin): confirm completion and release the remaining escrow. */
export async function confirmComplete(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  const v = viewer(req);
  if (!isOwner(ctx, v) && !isAdmin(v)) throw forbidden("Only the client can confirm completion");
  const result = await AppDataSource.transaction(async (m) => {
    await transitionJob(m, ctx.job.id, "confirm", { completedAt: new Date() });
    const job = await m.findOneOrFail(Job, { where: { id: ctx.job.id } });
    const released = await releaseRemaining(m, job, req.user!.id);
    return { ...released, rewards: await grantReferralRewards(m, job.id) };
  });
  if (result.rewards.length) await createNotifications(result.rewards);
  const autoReleased = result.released.length
    ? { count: result.released.length, paymentStatus: result.paymentStatus }
    : null;
  if (ctx.acceptedProId) {
    const total = result.released.reduce((s, m) => s + Number(m.amount), 0);
    await createNotification({
      userId: ctx.acceptedProId,
      type: NotificationType.JOB_STATUS,
      title: "Job completed",
      body: autoReleased
        ? `"${ctx.job.title}" was confirmed complete and ₹${total.toFixed(0)} was released. Great work!`
        : `"${ctx.job.title}" was confirmed complete. Great work!`,
      link: `/professional/jobs/${ctx.job.id}`,
      meta: { jobId: ctx.job.id, status: JobStatus.COMPLETED, autoReleased },
      text: !!autoReleased,
    });
  }
  const job = await jobRepo().findOneOrFail({ where: { id: ctx.job.id } });
  return res.json({ job: toJob(job, "private"), autoReleased });
}

/** Legacy endpoint: the professional marks done; the client/admin confirms. */
export async function completeJob(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  const v = viewer(req);
  if (isAwardedPro(ctx, v)) return markDone(req, res);
  if (isOwner(ctx, v) || isAdmin(v)) return confirmComplete(req, res);
  throw forbidden("You don't have access to this job");
}

/**
 * Call off a hire before work starts (client or hired pro).
 * Rules (simulated escrow): every milestone still held is refunded to the client; a deposit the
 * client already released stays with the professional.
 */
export async function cancelBooking(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  const v = viewer(req);
  const byClient = isOwner(ctx, v);
  const byPro = isAwardedPro(ctx, v);
  if (!byClient && !byPro) throw forbidden("Only the client or the hired professional can cancel this booking");
  if (ctx.job.status !== JobStatus.AWARDED) {
    throw conflict("A booking can only be called off before work starts", "INVALID_STATUS", { status: ctx.job.status });
  }
  const reason = (req.valid.body?.reason as string | undefined)?.trim() || null;
  const who = byClient ? "client" : "professional";
  const refund = await AppDataSource.transaction(async (m) => {
    await transitionJob(m, ctx.job.id, "cancel_booking", { cancellationReason: reason, cancelledBy: who });
    const job = await m.findOneOrFail(Job, { where: { id: ctx.job.id } });
    return refundMilestones(m, job, "all_unreleased", v.id, `Booking cancelled by the ${who}${reason ? `: ${reason}` : ""}`);
  });
  const otherParty = byClient ? ctx.acceptedProId : ctx.job.homeownerId;
  if (otherParty) {
    await createNotification({
      userId: otherParty,
      type: NotificationType.JOB_STATUS,
      title: "Booking cancelled",
      body: `The ${who} cancelled "${ctx.job.title}" before work started${reason ? `: ${reason.slice(0, 160)}` : "."}${
        refund.totalRefunded ? ` ₹${refund.totalRefunded.toFixed(0)} of held escrow was refunded to the client.` : ""
      }`,
      link: byClient ? `/professional/jobs/${ctx.job.id}` : `/client/jobs/${ctx.job.id}`,
      meta: { jobId: ctx.job.id, status: JobStatus.CANCELLED, cancelledBy: who, refunded: refund.totalRefunded },
    });
  }
  await revokeThreadStreams(ctx.job.id, null).catch(() => undefined);
  const job = await jobRepo().findOneOrFail({ where: { id: ctx.job.id } });
  return res.json({ job: toJob(job, "private"), refunded: refund.totalRefunded, paymentStatus: refund.paymentStatus });
}
