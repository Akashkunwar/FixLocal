import { creditUsedOnJob } from "../domain/credits";
import type { Request, Response } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../data-source";
import { Job } from "../entities/Job";
import { MilestoneStatus, PaymentMilestone } from "../entities/PaymentMilestone";
import { User } from "../entities/User";
import { AuditAction, AuditLog } from "../entities/AuditLog";
import { NotificationType } from "../entities/Notification";
import { createNotification } from "../utils/notifications";
import { toBillingParty, toJob, toMilestone } from "../serializers";
import { milestoneReleaseBlock, releaseMilestone as releaseMilestoneTx } from "../domain/escrow";
import { assertOwnerOrAdmin, assertPrivateAccess, loadJobContext } from "../policies/jobPolicy";
import { viewer } from "./jobController";
import { roundRupees } from "../domain/money";

export { splitEscrow as previewEscrowSplit } from "../domain/escrow";

export async function listMilestones(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertPrivateAccess(ctx, viewer(req));
  const job = ctx.job;
  const milestones = await AppDataSource.getRepository(PaymentMilestone).find({
    where: { jobId: job.id },
    order: { sequence: "ASC" },
  });
  const sum = (statuses: MilestoneStatus[]) =>
    roundRupees(milestones.filter((m) => statuses.includes(m.status)).reduce((s, m) => s + Number(m.amount), 0));

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

  const v = viewer(req);
  const credit =
    v.id === job.homeownerId || v.id === ctx.acceptedProId ? await creditUsedOnJob(AppDataSource.manager, v.id, job.id) : null;
  return res.json({
    jobId: job.id,
    credit,
    paymentStatus: job.paymentStatus,
    escrowAmount: job.escrowAmount != null ? Number(job.escrowAmount) : null,
    escrowSource: job.escrowSource || null,
    releasedTotal: sum([MilestoneStatus.RELEASED]),
    refundedTotal: sum([MilestoneStatus.REFUNDED]),
    remainingHeld: sum([MilestoneStatus.HELD, MilestoneStatus.PENDING]),
    milestones: milestones.map((m) => {
      const open = m.status === MilestoneStatus.HELD || m.status === MilestoneStatus.PENDING;
      const block = open ? milestoneReleaseBlock(m.sequence, milestones.length, job.status) : null;
      return { ...toMilestone(m), releaseBlockedReason: block?.message ?? null };
    }),
    parties: {
      homeowner: toBillingParty(byId.get(job.homeownerId)),
      tradesperson: ctx.acceptedProId ? toBillingParty(byId.get(ctx.acceptedProId)) : null,
    },
    auditNotes: auditLogs.map((a) => ({
      id: a.id,
      action: a.action,
      summary: a.summary || "",
      snippet: String((a.meta as Record<string, unknown> | undefined)?.note || a.summary || "").slice(0, 240),
      // Who on the FixLocal team wrote it stays internal; parties see the team as one.
      actorEmail: a.actorEmail ? "FixLocal support" : null,
      createdAt: a.createdAt,
    })),
  });
}

export async function releaseMilestone(req: Request, res: Response) {
  const ctx = await loadJobContext(req.valid.params.id);
  assertOwnerOrAdmin(ctx, viewer(req), "Only the client can release payments");
  // Stage checks (dispute freeze, "money follows the work") run inside the transaction under the job lock.
  const result = await AppDataSource.transaction((m) =>
    releaseMilestoneTx(m, ctx.job, req.valid.params.milestoneId, req.user!.id)
  );
  if (result.payeeUserId) {
    await createNotification({
      userId: result.payeeUserId,
      type: NotificationType.SYSTEM,
      title: "Payment released",
      body: `${result.milestone.label} (₹${Number(result.milestone.amount).toFixed(0)}) released on "${ctx.job.title}".${
        result.creditAdded ? ` Your ₹${result.creditAdded.toFixed(0)} FixLocal credit was added to this payout (simulated).` : ""
      }`,
      text: true,
      link: `/professional/jobs/${ctx.job.id}`,
      meta: { jobId: ctx.job.id, milestoneId: result.milestone.id },
    });
  }
  const job = await AppDataSource.getRepository(Job).findOneOrFail({ where: { id: ctx.job.id } });
  return res.json({ job: toJob(job, "private"), milestone: toMilestone(result.milestone), paymentStatus: result.paymentStatus });
}
