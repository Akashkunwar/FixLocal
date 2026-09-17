import type { Request, Response } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../data-source";
import { Job, JobStatus } from "../entities/Job";
import { MilestoneStatus, PaymentMilestone } from "../entities/PaymentMilestone";
import { User } from "../entities/User";
import { AuditAction, AuditLog } from "../entities/AuditLog";
import { NotificationType } from "../entities/Notification";
import { createNotification } from "../utils/notifications";
import { toContactUser, toJob, toMilestone } from "../serializers";
import { releaseMilestone as releaseMilestoneTx } from "../domain/escrow";
import { assertOwnerOrAdmin, assertPrivateAccess, loadJobContext } from "../policies/jobPolicy";
import { viewer } from "./jobController";
import { conflict } from "../http/errors";

export { splitEscrow as previewEscrowSplit } from "../domain/escrow";

const RELEASABLE: JobStatus[] = [
  JobStatus.AWARDED,
  JobStatus.IN_PROGRESS,
  JobStatus.PENDING_CONFIRMATION,
  JobStatus.COMPLETED,
];

export async function listMilestones(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertPrivateAccess(ctx, viewer(req));
  const job = ctx.job;
  const milestones = await AppDataSource.getRepository(PaymentMilestone).find({
    where: { jobId: job.id },
    order: { sequence: "ASC" },
  });
  const sum = (statuses: MilestoneStatus[]) =>
    Math.round(milestones.filter((m) => statuses.includes(m.status)).reduce((s, m) => s + Number(m.amount), 0) * 100) / 100;

  const partyIds = [job.homeownerId, ctx.acceptedProId].filter((x): x is string => !!x);
  const parties = await AppDataSource.getRepository(User).find({ where: { id: In(partyIds) } });
  const byId = new Map(parties.map((u) => [u.id, u]));

  const auditLogs = await AppDataSource.getRepository(AuditLog)
    .createQueryBuilder("a")
    .where("a.targetType = :tt AND a.targetId = :tid", { tt: "job", tid: job.id })
    .andWhere("a.action IN (:...actions)", {
      actions: [AuditAction.ADMIN_NOTE, AuditAction.DISPUTE_RESOLVE, AuditAction.FORCE_CANCEL, AuditAction.AUTO_CONFIRM],
    })
    .orderBy("a.createdAt", "DESC")
    .take(3)
    .getMany();

  return res.json({
    jobId: job.id,
    paymentStatus: job.paymentStatus,
    escrowAmount: job.escrowAmount != null ? Number(job.escrowAmount) : null,
    escrowSource: job.escrowSource || null,
    releasedTotal: sum([MilestoneStatus.RELEASED]),
    refundedTotal: sum([MilestoneStatus.REFUNDED]),
    remainingHeld: sum([MilestoneStatus.HELD, MilestoneStatus.PENDING]),
    milestones: milestones.map(toMilestone),
    parties: {
      homeowner: toContactUser(byId.get(job.homeownerId)),
      tradesperson: ctx.acceptedProId ? toContactUser(byId.get(ctx.acceptedProId)) : null,
    },
    auditNotes: auditLogs.map((a) => ({
      id: a.id,
      action: a.action,
      summary: a.summary || "",
      snippet: String((a.meta as Record<string, unknown> | undefined)?.note || a.summary || "").slice(0, 240),
      actorEmail: a.actorEmail || null,
      createdAt: a.createdAt,
    })),
  });
}

export async function releaseMilestone(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertOwnerOrAdmin(ctx, viewer(req), "Only the client can release payments");
  if (!RELEASABLE.includes(ctx.job.status)) {
    throw conflict("Payments can't be released in the job's current status", "INVALID_STATUS");
  }
  const result = await AppDataSource.transaction((m) =>
    releaseMilestoneTx(m, ctx.job, req.valid.params.milestoneId, req.user!.id)
  );
  if (result.payeeUserId) {
    await createNotification({
      userId: result.payeeUserId,
      type: NotificationType.SYSTEM,
      title: "Payment released",
      body: `${result.milestone.label} (₹${Number(result.milestone.amount).toFixed(0)}) released on "${ctx.job.title}".`,
      link: `/professional/jobs/${ctx.job.id}`,
      meta: { jobId: ctx.job.id, milestoneId: result.milestone.id },
    });
  }
  const job = await AppDataSource.getRepository(Job).findOneOrFail({ where: { id: ctx.job.id } });
  return res.json({ job: toJob(job, "private"), milestone: toMilestone(result.milestone), paymentStatus: result.paymentStatus });
}
