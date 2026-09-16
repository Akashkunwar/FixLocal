import { Request, Response } from "express";
import { param } from "../utils/params";
import { AppDataSource } from "../data-source";
import { Bid } from "../entities/Bid";
import { Job, JobStatus, PaymentStatus } from "../entities/Job";
import {
  PaymentMilestone,
  MilestoneStatus,
} from "../entities/PaymentMilestone";
import { User, UserRole } from "../entities/User";
import { NotificationType } from "../entities/Notification";
import { createNotification } from "../utils/notifications";
import { escrowAmountFromBid } from "../utils/matchScore";
import { AuditLog, AuditAction } from "../entities/AuditLog";

const jobRepo = () => AppDataSource.getRepository(Job);
const bidRepo = () => AppDataSource.getRepository(Bid);
const milestoneRepo = () => AppDataSource.getRepository(PaymentMilestone);

export const MILESTONE_TEMPLATE = [
  { label: "Deposit", percent: 30 },
  { label: "Progress", percent: 40 },
  { label: "Completion", percent: 30 },
];

/** Soft escrow what-if: milestone split for a proposed hold amount (simulated). */
export function previewEscrowSplit(totalAmount: number) {
  const total = Math.round(Number(totalAmount) * 100) / 100;
  if (!Number.isFinite(total) || total <= 0) {
    return { amount: 0, milestones: [] as { label: string; sequence: number; percent: number; amount: number }[] };
  }
  const milestones: { label: string; sequence: number; percent: number; amount: number }[] = [];
  let allocated = 0;
  for (let i = 0; i < MILESTONE_TEMPLATE.length; i++) {
    const tmpl = MILESTONE_TEMPLATE[i];
    const isLast = i === MILESTONE_TEMPLATE.length - 1;
    const amount = isLast
      ? Math.round((total - allocated) * 100) / 100
      : Math.round(((total * tmpl.percent) / 100) * 100) / 100;
    allocated += amount;
    milestones.push({
      label: tmpl.label,
      sequence: i + 1,
      percent: tmpl.percent,
      amount,
    });
  }
  return { amount: total, milestones };
}

export async function createEscrowForAcceptedBid(
  job: Job,
  bid: Bid,
  manager = AppDataSource.manager
) {
  const escrowInfo = escrowAmountFromBid(bid);
  const total = escrowInfo.amount;
  job.escrowAmount = total;
  job.escrowSource = escrowInfo.source;
  job.paymentStatus = PaymentStatus.HELD;

  const milestones: PaymentMilestone[] = [];
  let allocated = 0;
  for (let i = 0; i < MILESTONE_TEMPLATE.length; i++) {
    const tmpl = MILESTONE_TEMPLATE[i];
    const isLast = i === MILESTONE_TEMPLATE.length - 1;
    const amount = isLast
      ? Math.round((total - allocated) * 100) / 100
      : Math.round(((total * tmpl.percent) / 100) * 100) / 100;
    allocated += amount;

    const m = manager.create(PaymentMilestone, {
      jobId: job.id,
      label: tmpl.label,
      sequence: i + 1,
      amount,
      percent: tmpl.percent,
      // Deposit is immediately held in escrow on accept
      status: i === 0 ? MilestoneStatus.HELD : MilestoneStatus.PENDING,
    });
    milestones.push(m);
  }
  await manager.save(milestones);
  return milestones;
}

async function canViewJobPayments(job: Job, userId: string, role: UserRole) {
  if (role === UserRole.ADMIN) return true;
  if (job.homeownerId === userId) return true;
  if (job.acceptedBidId) {
    const accepted = await bidRepo().findOne({ where: { id: job.acceptedBidId } });
    if (accepted && accepted.tradespersonId === userId) return true;
  }
  return false;
}

export async function listMilestones(req: Request, res: Response) {
  let job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (!(await canViewJobPayments(job, req.user!.id, req.user!.role))) {
    return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
  }

  if (job.acceptedBidId) {
    await ensureMilestonesForJob(job);
    job = (await jobRepo().findOne({ where: { id: job.id } })) || job;
    if (job && !job.escrowSource) {
      const bid = await bidRepo().findOne({ where: { id: job.acceptedBidId } });
      if (bid) {
        job.escrowSource = escrowAmountFromBid(bid).source;
        await jobRepo().save(job);
      }
    }
  }

  const milestones = await milestoneRepo().find({
    where: { jobId: job.id },
    order: { sequence: "ASC" },
  });

  const released = milestones
    .filter((m) => m.status === MilestoneStatus.RELEASED)
    .reduce((s, m) => s + Number(m.amount), 0);
  const held = milestones
    .filter((m) => m.status === MilestoneStatus.HELD || m.status === MilestoneStatus.PENDING)
    .reduce((s, m) => s + Number(m.amount), 0);

  let homeownerParty: { id: string; name?: string | null; email?: string } | null = null;
  let tradespersonParty: { id: string; name?: string | null; email?: string } | null = null;
  const homeowner = await AppDataSource.getRepository(User).findOne({
    where: { id: job.homeownerId },
  });
  if (homeowner) {
    homeownerParty = { id: homeowner.id, name: homeowner.name, email: homeowner.email };
  }
  if (job.acceptedBidId) {
    const accepted = await bidRepo().findOne({ where: { id: job.acceptedBidId } });
    if (accepted) {
      const pro = await AppDataSource.getRepository(User).findOne({
        where: { id: accepted.tradespersonId },
      });
      if (pro) {
        tradespersonParty = { id: pro.id, name: pro.name, email: pro.email };
      }
    }
  }

  const auditLogs = await AppDataSource.getRepository(AuditLog)
    .createQueryBuilder("a")
    .where("a.targetType = :tt", { tt: "job" })
    .andWhere("a.targetId = :tid", { tid: job.id })
    .andWhere("a.action IN (:...actions)", {
      actions: [AuditAction.ADMIN_NOTE, AuditAction.DISPUTE_RESOLVE, AuditAction.FORCE_CANCEL],
    })
    .orderBy("a.createdAt", "DESC")
    .take(3)
    .getMany();

  const auditNotes = auditLogs.map((a) => ({
    id: a.id,
    action: a.action,
    summary: a.summary || "",
    snippet: String(a.meta?.note || a.summary || "").slice(0, 240),
    actorEmail: a.actorEmail || null,
    createdAt: a.createdAt,
  }));

  return res.json({
    jobId: job.id,
    paymentStatus: job.paymentStatus,
    escrowAmount: job.escrowAmount != null ? Number(job.escrowAmount) : null,
    escrowSource: job.escrowSource || null,
    releasedTotal: released,
    remainingHeld: held,
    milestones,
    parties: {
      homeowner: homeownerParty,
      tradesperson: tradespersonParty,
    },
    auditNotes,
  });
}

export async function releaseMilestone(req: Request, res: Response) {
  const job = await jobRepo().findOne({ where: { id: param(req, "id") } });
  if (!job) {
    return res.status(404).json({ message: "Job not found", code: "NOT_FOUND" });
  }
  if (job.homeownerId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
    return res.status(403).json({ message: "Only the homeowner can release milestones", code: "FORBIDDEN" });
  }

  const allowedJob = [
    JobStatus.AWARDED,
    JobStatus.IN_PROGRESS,
    JobStatus.COMPLETED,
  ];
  if (!allowedJob.includes(job.status)) {
    return res.status(400).json({
      message: "Cannot release milestones in the current job status",
      code: "INVALID_STATUS",
    });
  }

  const milestone = await milestoneRepo().findOne({
    where: { id: param(req, "milestoneId"), jobId: job.id },
  });
  if (!milestone) {
    return res.status(404).json({ message: "Milestone not found", code: "NOT_FOUND" });
  }
  if (milestone.status === MilestoneStatus.RELEASED) {
    return res.status(400).json({ message: "Milestone already released", code: "ALREADY_RELEASED" });
  }
  if (milestone.status === MilestoneStatus.REFUNDED) {
    return res.status(400).json({ message: "Milestone was refunded", code: "REFUNDED" });
  }

  // Enforce sequential release
  const prior = await milestoneRepo()
    .createQueryBuilder("m")
    .where("m.jobId = :jobId AND m.sequence < :seq", {
      jobId: job.id,
      seq: milestone.sequence,
    })
    .andWhere("m.status != :released", { released: MilestoneStatus.RELEASED })
    .getCount();
  if (prior > 0) {
    return res.status(400).json({
      message: "Release earlier milestones first",
      code: "OUT_OF_ORDER",
    });
  }

  milestone.status = MilestoneStatus.RELEASED;
  milestone.releasedAt = new Date();
  milestone.releasedByUserId = req.user!.id;
  await milestoneRepo().save(milestone);

  // Move next pending into held
  const next = await milestoneRepo().findOne({
    where: { jobId: job.id, sequence: milestone.sequence + 1 },
  });
  if (next && next.status === MilestoneStatus.PENDING) {
    next.status = MilestoneStatus.HELD;
    await milestoneRepo().save(next);
  }

  const all = await milestoneRepo().find({ where: { jobId: job.id } });
  const allReleased = all.every((m) => m.status === MilestoneStatus.RELEASED);
  const anyReleased = all.some((m) => m.status === MilestoneStatus.RELEASED);
  if (allReleased) {
    job.paymentStatus = PaymentStatus.RELEASED;
  } else if (anyReleased) {
    job.paymentStatus = PaymentStatus.PARTIALLY_RELEASED;
  } else {
    job.paymentStatus = PaymentStatus.HELD;
  }
  await jobRepo().save(job);

  let proId: string | undefined;
  if (job.acceptedBidId) {
    const accepted = await bidRepo().findOne({ where: { id: job.acceptedBidId } });
    proId = accepted?.tradespersonId;
  }
  if (proId) {
    await createNotification({
      userId: proId,
      type: NotificationType.SYSTEM,
      title: "Milestone released",
      body: `${milestone.label} (₹${Number(milestone.amount).toFixed(0)}) released on "${job.title}".`,
      link: `/tradesperson/jobs/${job.id}`,
      meta: { jobId: job.id, milestoneId: milestone.id },
    });
  }

  return res.json({
    job,
    milestone,
    paymentStatus: job.paymentStatus,
  });
}


/** Release all remaining held/pending milestones in order (used when homeowner completes). */
export async function autoReleaseRemainingEscrow(
  job: Job,
  releasedByUserId: string
): Promise<{ released: PaymentMilestone[]; paymentStatus: PaymentStatus }> {
  await ensureMilestonesForJob(job);
  const milestones = await milestoneRepo().find({
    where: { jobId: job.id },
    order: { sequence: "ASC" },
  });

  const released: PaymentMilestone[] = [];
  for (const m of milestones) {
    if (m.status === MilestoneStatus.RELEASED || m.status === MilestoneStatus.REFUNDED) {
      continue;
    }
    m.status = MilestoneStatus.RELEASED;
    m.releasedAt = new Date();
    m.releasedByUserId = releasedByUserId;
    await milestoneRepo().save(m);
    released.push(m);
  }

  const all = await milestoneRepo().find({ where: { jobId: job.id } });
  const allReleased =
    all.length > 0 && all.every((m) => m.status === MilestoneStatus.RELEASED);
  const anyReleased = all.some((m) => m.status === MilestoneStatus.RELEASED);
  if (allReleased) {
    job.paymentStatus = PaymentStatus.RELEASED;
  } else if (anyReleased) {
    job.paymentStatus = PaymentStatus.PARTIALLY_RELEASED;
  }
  await jobRepo().save(job);

  if (released.length > 0) {
    let proId: string | undefined;
    if (job.acceptedBidId) {
      const accepted = await bidRepo().findOne({ where: { id: job.acceptedBidId } });
      proId = accepted?.tradespersonId;
    }
    if (proId) {
      const total = released.reduce((s, m) => s + Number(m.amount), 0);
      await createNotification({
        userId: proId,
        type: NotificationType.SYSTEM,
        title: "Escrow auto-released",
        body: `Homeowner completed "${job.title}" — ${released.length} milestone(s) (₹${total.toFixed(0)}) released from escrow.`,
        link: `/tradesperson/jobs/${job.id}`,
        meta: { jobId: job.id, autoRelease: true, milestoneIds: released.map((m) => m.id) },
      });
    }
  }

  return { released, paymentStatus: job.paymentStatus };
}

/** Ensure legacy awarded jobs with simulated_paid get milestones lazily. */
export async function ensureMilestonesForJob(job: Job) {
  if (!job.acceptedBidId) return;
  const existing = await milestoneRepo().count({ where: { jobId: job.id } });
  if (existing > 0) return;
  const bid = await bidRepo().findOne({ where: { id: job.acceptedBidId } });
  if (!bid) return;
  await AppDataSource.transaction(async (manager) => {
    await createEscrowForAcceptedBid(job, bid, manager);
    // If previously "simulated_paid", keep as held in escrow
    if (
      job.paymentStatus === PaymentStatus.SIMULATED_PAID ||
      job.paymentStatus === PaymentStatus.PENDING
    ) {
      job.paymentStatus = PaymentStatus.HELD;
    }
    if (!job.escrowSource) {
      job.escrowSource = escrowAmountFromBid(bid).source;
    }
    await manager.save(job);
  });
}


/** Admin / dispute: reverse or refund selected milestones (simulated). */
export async function refundMilestonesForJob(
  job: Job,
  milestoneIds: string[],
  refundedByUserId: string,
  note?: string
): Promise<{ refunded: PaymentMilestone[]; paymentStatus: PaymentStatus; totalRefunded: number }> {
  await ensureMilestonesForJob(job);
  const uniqueIds = [...new Set(milestoneIds.map(String).filter(Boolean))];
  const refunded: PaymentMilestone[] = [];
  let totalRefunded = 0;

  for (const mid of uniqueIds) {
    const m = await milestoneRepo().findOne({ where: { id: mid, jobId: job.id } });
    if (!m) continue;
    if (m.status === MilestoneStatus.REFUNDED) continue;
    m.status = MilestoneStatus.REFUNDED;
    m.refundedAt = new Date();
    m.refundedByUserId = refundedByUserId;
    m.refundNote = note ? String(note).slice(0, 500) : undefined;
    await milestoneRepo().save(m);
    refunded.push(m);
    totalRefunded += Number(m.amount);
  }

  const all = await milestoneRepo().find({ where: { jobId: job.id }, order: { sequence: "ASC" } });
  const anyReleased = all.some((m) => m.status === MilestoneStatus.RELEASED);
  const anyRefunded = all.some((m) => m.status === MilestoneStatus.REFUNDED);
  const anyHeld = all.some(
    (m) => m.status === MilestoneStatus.HELD || m.status === MilestoneStatus.PENDING
  );
  const allRefunded = all.length > 0 && all.every((m) => m.status === MilestoneStatus.REFUNDED);
  const allReleasedOrRefunded =
    all.length > 0 &&
    all.every(
      (m) => m.status === MilestoneStatus.RELEASED || m.status === MilestoneStatus.REFUNDED
    );

  if (allRefunded) {
    job.paymentStatus = PaymentStatus.REFUNDED;
  } else if (anyReleased && (anyRefunded || anyHeld)) {
    job.paymentStatus = PaymentStatus.PARTIALLY_RELEASED;
  } else if (allReleasedOrRefunded && anyReleased && !anyHeld) {
    job.paymentStatus = anyRefunded ? PaymentStatus.PARTIALLY_RELEASED : PaymentStatus.RELEASED;
  } else if (anyHeld && !anyReleased) {
    job.paymentStatus = PaymentStatus.HELD;
  }
  await jobRepo().save(job);

  return { refunded, paymentStatus: job.paymentStatus, totalRefunded };
}
