import type { EntityManager } from "typeorm";
import { In } from "typeorm";
import { Bid } from "../entities/Bid";
import { Job, PaymentStatus } from "../entities/Job";
import { LedgerEntry, LedgerType } from "../entities/LedgerEntry";
import { MilestoneStatus, PaymentMilestone } from "../entities/PaymentMilestone";
import { badRequest, conflict, notFound } from "../http/errors";

export const MILESTONE_TEMPLATE = [
  { label: "Deposit", percent: 30 },
  { label: "Progress", percent: 40 },
  { label: "Completion", percent: 30 },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

export function splitEscrow(totalAmount: number) {
  const total = round2(Number(totalAmount));
  if (!Number.isFinite(total) || total <= 0) return { amount: 0, milestones: [] as SplitRow[] };
  let allocated = 0;
  const milestones: SplitRow[] = MILESTONE_TEMPLATE.map((tmpl, i) => {
    const isLast = i === MILESTONE_TEMPLATE.length - 1;
    const amount = isLast ? round2(total - allocated) : round2((total * tmpl.percent) / 100);
    allocated = round2(allocated + amount);
    return { label: tmpl.label, sequence: i + 1, percent: tmpl.percent, amount };
  });
  return { amount: total, milestones };
}

type SplitRow = { label: string; sequence: number; percent: number; amount: number };

/** Escrow is funded from the structured quote when present, otherwise the bid amount. */
export function escrowAmountFromBid(bid: { amount: number | string; quoteAmount?: number | string | null }) {
  const q = Number(bid.quoteAmount);
  if (Number.isFinite(q) && q > 0) return { amount: round2(q), source: "quote" as const };
  const a = Number(bid.amount);
  return { amount: Number.isFinite(a) && a > 0 ? round2(a) : 0, source: "bid" as const };
}

async function lockJob(manager: EntityManager, jobId: string) {
  const rows = await manager.query(`SELECT "id" FROM "jobs" WHERE "id" = $1 FOR UPDATE`, [jobId]);
  if (!rows.length) throw notFound("Job not found");
}

async function payeeFor(manager: EntityManager, job: Pick<Job, "acceptedBidId">): Promise<string | null> {
  if (!job.acceptedBidId) return null;
  const bid = await manager.findOne(Bid, { where: { id: job.acceptedBidId }, select: { id: true, tradespersonId: true } });
  return bid?.tradespersonId ?? null;
}

async function ledger(
  manager: EntityManager,
  job: Pick<Job, "id" | "homeownerId">,
  entries: { type: LedgerType; amount: number; milestoneId?: string | null; note?: string }[],
  actorUserId: string | null,
  payeeUserId: string | null
) {
  if (!entries.length) return;
  await manager.insert(
    LedgerEntry,
    entries.map((e) => ({
      jobId: job.id,
      milestoneId: e.milestoneId ?? null,
      type: e.type,
      amount: round2(e.amount),
      payerUserId: job.homeownerId,
      payeeUserId,
      actorUserId,
      note: e.note ?? null,
    }))
  );
}

/** Called inside the accept transaction. Unique (jobId, sequence) blocks double escrow. */
export async function createEscrow(
  manager: EntityManager,
  job: Job,
  proId: string,
  amount: number,
  actorUserId: string
): Promise<PaymentMilestone[]> {
  const split = splitEscrow(amount);
  const rows = split.milestones.map((m, i) =>
    manager.create(PaymentMilestone, {
      jobId: job.id,
      label: m.label,
      sequence: m.sequence,
      amount: m.amount,
      percent: m.percent,
      status: i === 0 ? MilestoneStatus.HELD : MilestoneStatus.PENDING,
    })
  );
  const saved = await manager.save(rows);
  await ledger(
    manager,
    job,
    saved.map((m) => ({ type: LedgerType.HOLD, amount: Number(m.amount), milestoneId: m.id, note: m.label })),
    actorUserId,
    proId
  );
  return saved;
}

export function paymentStatusFor(milestones: Pick<PaymentMilestone, "status">[], fallback: PaymentStatus): PaymentStatus {
  if (!milestones.length) return fallback;
  const released = milestones.filter((m) => m.status === MilestoneStatus.RELEASED).length;
  const refunded = milestones.filter((m) => m.status === MilestoneStatus.REFUNDED).length;
  const open = milestones.length - released - refunded;
  if (open === 0 && refunded === 0) return PaymentStatus.RELEASED;
  if (open === 0 && released === 0) return PaymentStatus.REFUNDED;
  if (open === 0 || released > 0) return PaymentStatus.PARTIALLY_RELEASED;
  return PaymentStatus.HELD;
}

async function syncPaymentStatus(manager: EntityManager, job: Job): Promise<PaymentStatus> {
  const all = await manager.find(PaymentMilestone, { where: { jobId: job.id }, order: { sequence: "ASC" } });
  const status = paymentStatusFor(all, job.paymentStatus);
  await manager.update(Job, { id: job.id }, { paymentStatus: status });
  job.paymentStatus = status;
  return status;
}

async function releaseRow(manager: EntityManager, jobId: string, milestoneId: string, actorUserId: string) {
  const res = await manager
    .createQueryBuilder()
    .update(PaymentMilestone)
    .set({ status: MilestoneStatus.RELEASED, releasedAt: () => "now()", releasedByUserId: actorUserId })
    .where(`"id" = :id AND "jobId" = :jobId AND "status" IN (:...open)`, {
      id: milestoneId,
      jobId,
      open: [MilestoneStatus.HELD, MilestoneStatus.PENDING],
    })
    .returning("*")
    .execute();
  return res.affected ? (manager.create(PaymentMilestone, res.raw[0]) as PaymentMilestone) : null;
}

/** Release one milestone. Earlier milestones must be settled first. */
export async function releaseMilestone(manager: EntityManager, job: Job, milestoneId: string, actorUserId: string) {
  await lockJob(manager, job.id);
  const milestone = await manager.findOne(PaymentMilestone, { where: { id: milestoneId, jobId: job.id } });
  if (!milestone) throw notFound("Milestone not found");
  if (milestone.status === MilestoneStatus.RELEASED) throw conflict("Milestone already released", "ALREADY_RELEASED");
  if (milestone.status === MilestoneStatus.REFUNDED) throw conflict("Milestone was refunded", "REFUNDED");
  const unsettledBefore = await manager
    .createQueryBuilder(PaymentMilestone, "m")
    .where(`m."jobId" = :jobId AND m."sequence" < :seq`, { jobId: job.id, seq: milestone.sequence })
    .andWhere(`m."status" IN (:...open)`, { open: [MilestoneStatus.HELD, MilestoneStatus.PENDING] })
    .getCount();
  if (unsettledBefore > 0) throw badRequest("Release earlier milestones first", "OUT_OF_ORDER");

  const released = await releaseRow(manager, job.id, milestone.id, actorUserId);
  if (!released) throw conflict("Milestone already released", "ALREADY_RELEASED");

  await manager
    .createQueryBuilder()
    .update(PaymentMilestone)
    .set({ status: MilestoneStatus.HELD })
    .where(`"jobId" = :jobId AND "sequence" = :seq AND "status" = :pending`, {
      jobId: job.id,
      seq: milestone.sequence + 1,
      pending: MilestoneStatus.PENDING,
    })
    .execute();

  const payee = await payeeFor(manager, job);
  await ledger(manager, job, [{ type: LedgerType.RELEASE, amount: Number(released.amount), milestoneId: released.id, note: released.label }], actorUserId, payee);
  const paymentStatus = await syncPaymentStatus(manager, job);
  return { milestone: released, paymentStatus, payeeUserId: payee };
}

/** Release every unsettled milestone (client confirmation, auto-confirm, dispute won by the pro). */
export async function releaseRemaining(manager: EntityManager, job: Job, actorUserId: string | null) {
  await lockJob(manager, job.id);
  const open = await manager.find(PaymentMilestone, {
    where: { jobId: job.id, status: In([MilestoneStatus.HELD, MilestoneStatus.PENDING]) },
    order: { sequence: "ASC" },
  });
  const released: PaymentMilestone[] = [];
  for (const m of open) {
    const row = await releaseRow(manager, job.id, m.id, actorUserId ?? job.homeownerId);
    if (row) released.push(row);
  }
  const payee = await payeeFor(manager, job);
  await ledger(
    manager,
    job,
    released.map((m) => ({ type: LedgerType.RELEASE, amount: Number(m.amount), milestoneId: m.id, note: m.label })),
    actorUserId,
    payee
  );
  const paymentStatus = await syncPaymentStatus(manager, job);
  return { released, paymentStatus, payeeUserId: payee };
}

/**
 * Refund unsettled milestones. Released money is never clawed back;
 * released ids passed in are reported as not refundable.
 */
export async function refundMilestones(
  manager: EntityManager,
  job: Job,
  milestoneIds: string[] | "all_unreleased",
  actorUserId: string | null,
  note: string
) {
  await lockJob(manager, job.id);
  const all = await manager.find(PaymentMilestone, { where: { jobId: job.id }, order: { sequence: "ASC" } });
  const wanted =
    milestoneIds === "all_unreleased" ? all : all.filter((m) => milestoneIds.includes(m.id));
  if (milestoneIds !== "all_unreleased") {
    const unknown = milestoneIds.filter((id) => !all.some((m) => m.id === id));
    if (unknown.length) throw badRequest("Some milestones don't belong to this job", "INVALID_MILESTONE");
  }
  const notRefundable = wanted.filter((m) => m.status === MilestoneStatus.RELEASED).map((m) => m.id);
  if (milestoneIds !== "all_unreleased" && notRefundable.length) {
    throw badRequest("Released milestones can't be refunded", "ALREADY_RELEASED", { notRefundable });
  }
  const refunded: PaymentMilestone[] = [];
  for (const m of wanted) {
    if (m.status !== MilestoneStatus.HELD && m.status !== MilestoneStatus.PENDING) continue;
    const res = await manager
      .createQueryBuilder()
      .update(PaymentMilestone)
      .set({
        status: MilestoneStatus.REFUNDED,
        refundedAt: () => "now()",
        refundedByUserId: actorUserId ?? job.homeownerId,
        refundNote: note.slice(0, 500),
      })
      .where(`"id" = :id AND "status" IN (:...open)`, {
        id: m.id,
        open: [MilestoneStatus.HELD, MilestoneStatus.PENDING],
      })
      .returning("*")
      .execute();
    if (res.affected) refunded.push(manager.create(PaymentMilestone, res.raw[0]) as PaymentMilestone);
  }
  const payee = await payeeFor(manager, job);
  await ledger(
    manager,
    job,
    refunded.map((m) => ({ type: LedgerType.REFUND, amount: Number(m.amount), milestoneId: m.id, note })),
    actorUserId,
    payee
  );
  const paymentStatus = await syncPaymentStatus(manager, job);
  const totalRefunded = round2(refunded.reduce((s, m) => s + Number(m.amount), 0));
  return { refunded, notRefundable, totalRefunded, paymentStatus };
}

/** Sum of released escrow per professional (ledger is the source of truth). */
export async function releasedTotalsByJob(manager: EntityManager, payeeUserId: string) {
  const rows: { jobId: string; total: string; lastAt: Date }[] = await manager.query(
    `SELECT "jobId", SUM("amount") AS total, MAX("createdAt") AS "lastAt"
     FROM "ledger_entries" WHERE "payeeUserId" = $1 AND "type" = 'release'
     GROUP BY "jobId"`,
    [payeeUserId]
  );
  return new Map(rows.map((r) => [r.jobId, { total: Number(r.total), lastAt: new Date(r.lastAt) }]));
}
