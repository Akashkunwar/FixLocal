import { applyProCredit, restoreClientCredit, reverseReferralRewards } from "./credits";
import type { EntityManager } from "typeorm";
import { In } from "typeorm";
import { Bid } from "../entities/Bid";
import { Job, JobStatus, PaymentStatus } from "../entities/Job";
import { LedgerEntry, LedgerType, PAYOUT_TYPES } from "../entities/LedgerEntry";
import { MilestoneStatus, PaymentMilestone } from "../entities/PaymentMilestone";
import { badRequest, conflict, notFound } from "../http/errors";
import { paymentProvider } from "../services/payments";
import { roundRupees } from "./money";

export const MILESTONE_TEMPLATE = [
  { label: "Deposit", percent: 30 },
  { label: "Progress", percent: 40 },
  { label: "Completion", percent: 30 },
];


export function splitEscrow(totalAmount: number) {
  const total = roundRupees(Number(totalAmount));
  if (!Number.isFinite(total) || total <= 0) return { amount: 0, milestones: [] as SplitRow[] };
  let allocated = 0;
  const milestones: SplitRow[] = MILESTONE_TEMPLATE.map((tmpl, i) => {
    const isLast = i === MILESTONE_TEMPLATE.length - 1;
    const amount = isLast ? roundRupees(total - allocated) : roundRupees((total * tmpl.percent) / 100);
    allocated = roundRupees(allocated + amount);
    return { label: tmpl.label, sequence: i + 1, percent: tmpl.percent, amount };
  });
  return { amount: total, milestones };
}

type SplitRow = { label: string; sequence: number; percent: number; amount: number };

/** Escrow is funded from the structured quote when present, otherwise the bid amount. */
export function escrowAmountFromBid(bid: { amount: number | string; quoteAmount?: number | string | null }) {
  const q = Number(bid.quoteAmount);
  if (Number.isFinite(q) && q > 0) return { amount: roundRupees(q), source: "quote" as const };
  const a = Number(bid.amount);
  return { amount: Number.isFinite(a) && a > 0 ? roundRupees(a) : 0, source: "bid" as const };
}

async function lockJob(manager: EntityManager, jobId: string): Promise<JobStatus> {
  const rows: { status: JobStatus }[] = await manager.query(`SELECT "status" FROM "jobs" WHERE "id" = $1 FOR UPDATE`, [jobId]);
  if (!rows.length) throw notFound("Job not found");
  return rows[0].status;
}

const S = JobStatus;

/**
 * Which job stage a milestone may be released in by hand. Money follows the work:
 * - Deposit (first): once a pro is hired
 * - Progress (middle): once work has started
 * - Completion (last): once the pro has marked the work done
 * Confirming completion (or an admin dispute ruling) releases everything left regardless.
 * A disputed or cancelled job never releases by hand.
 */
export function milestoneReleaseStages(sequence: number, totalMilestones: number): JobStatus[] {
  const afterDone = [S.PENDING_CONFIRMATION, S.COMPLETED];
  if (sequence >= totalMilestones && totalMilestones > 1) return afterDone;
  if (sequence > 1) return [S.IN_PROGRESS, ...afterDone];
  return [S.AWARDED, S.IN_PROGRESS, ...afterDone];
}

/** Null when the milestone may be released in this job status, otherwise a reason the client can read. */
export function milestoneReleaseBlock(
  sequence: number,
  totalMilestones: number,
  status: JobStatus
): { code: string; message: string } | null {
  if (milestoneReleaseStages(sequence, totalMilestones).includes(status)) return null;
  if (status === S.DISPUTED) return { code: "DISPUTED", message: "Payments are frozen while a dispute is open" };
  if (status === S.CANCELLED || status === S.OPEN || status === S.BIDDING_CLOSED) {
    return { code: "INVALID_STATUS", message: "Payments can't be released in the job's current status" };
  }
  if (sequence >= totalMilestones && totalMilestones > 1) {
    return { code: "TOO_EARLY", message: "The completion payment unlocks when the professional marks the work done" };
  }
  return { code: "TOO_EARLY", message: "This payment unlocks once the professional starts work" };
}

async function payeeFor(manager: EntityManager, job: Pick<Job, "acceptedBidId">): Promise<string | null> {
  if (!job.acceptedBidId) return null;
  const bid = await manager.findOne(Bid, { where: { id: job.acceptedBidId }, select: { id: true, tradespersonId: true } });
  return bid?.tradespersonId ?? null;
}

type Movement = "hold" | "release" | "refund";
const CREDIT_TYPE: Record<Movement, LedgerType> = {
  hold: LedgerType.CREDIT_HOLD,
  release: LedgerType.CREDIT_RELEASE,
  refund: LedgerType.CREDIT_REFUND,
};
const CLIENT_TYPE: Record<Movement, LedgerType> = { hold: LedgerType.HOLD, release: LedgerType.RELEASE, refund: LedgerType.REFUND };

/**
 * Ledger rows for moving milestones: the client-funded part and the credit-funded part are separate
 * rows, so client totals only ever show what the client paid and payouts still add up to the milestone.
 */
function milestoneEntries(milestones: PaymentMilestone[], movement: Movement, note?: string) {
  return milestones.flatMap((m) => {
    const credit = roundRupees(Number(m.creditAmount || 0));
    const client = roundRupees(Number(m.amount) - credit);
    const label = note ?? m.label;
    return [
      { type: CLIENT_TYPE[movement], amount: client, milestoneId: m.id, note: label },
      { type: CREDIT_TYPE[movement], amount: credit, milestoneId: m.id, note: `${label} (FixLocal credit)`, payerUserId: null },
    ].filter((e) => e.amount > 0);
  });
}

async function ledger(
  manager: EntityManager,
  job: Pick<Job, "id" | "homeownerId">,
  entries: { type: LedgerType; amount: number; milestoneId?: string | null; note?: string; payerUserId?: string | null }[],
  actorUserId: string | null,
  payeeUserId: string | null
) {
  if (!entries.length) return;
  const provider = paymentProvider();
  const rows = [];
  for (const e of entries) {
    const amount = roundRupees(e.amount);
    const payerUserId = e.payerUserId === undefined ? job.homeownerId : e.payerUserId;
    // Milestone + movement type is unique (a milestone is held, then released or refunded once).
    const { reference } = await provider.record({
      type: e.type,
      jobId: job.id,
      milestoneId: e.milestoneId ?? null,
      amount,
      currency: "INR",
      payerUserId,
      payeeUserId,
      idempotencyKey: `${job.id}:${e.milestoneId ?? "job"}:${e.type}`,
    });
    rows.push({
      jobId: job.id,
      milestoneId: e.milestoneId ?? null,
      type: e.type,
      amount,
      payerUserId,
      payeeUserId,
      actorUserId,
      note: e.note ?? null,
      providerRef: reference,
    });
  }
  await manager.insert(LedgerEntry, rows);
}

/**
 * Called inside the accept transaction. Unique (jobId, sequence) blocks double escrow.
 * `creditAmount` is the client's referral credit used at this hire: it funds the earliest milestones
 * first, and the client funds the rest.
 */
export async function createEscrow(
  manager: EntityManager,
  job: Job,
  proId: string,
  amount: number,
  actorUserId: string,
  creditAmount = 0
): Promise<PaymentMilestone[]> {
  const split = splitEscrow(amount);
  let creditLeft = roundRupees(Math.max(0, Math.min(creditAmount, split.amount)));
  const rows = split.milestones.map((m, i) => {
    const credit = roundRupees(Math.min(creditLeft, m.amount));
    creditLeft = roundRupees(creditLeft - credit);
    return manager.create(PaymentMilestone, {
      jobId: job.id,
      label: m.label,
      sequence: m.sequence,
      amount: m.amount,
      creditAmount: credit,
      percent: m.percent,
      status: i === 0 ? MilestoneStatus.HELD : MilestoneStatus.PENDING,
    });
  });
  const saved = await manager.save(rows);
  await ledger(manager, job, milestoneEntries(saved, "hold"), actorUserId, proId);
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
  // The status is read under the row lock, so a dispute or cancellation that lands
  // between the request arriving and this transaction is respected.
  const status = await lockJob(manager, job.id);
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
  const total = await manager.count(PaymentMilestone, { where: { jobId: job.id } });
  const block = milestoneReleaseBlock(milestone.sequence, total, status);
  if (block) throw conflict(block.message, block.code, { status });

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
  await ledger(manager, job, milestoneEntries([released], "release"), actorUserId, payee);
  const creditAdded = payee ? await payProCredit(manager, job, payee, released.id, actorUserId) : 0;
  const paymentStatus = await syncPaymentStatus(manager, job);
  return { milestone: released, paymentStatus, payeeUserId: payee, creditAdded };
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
  await ledger(manager, job, milestoneEntries(released, "release"), actorUserId, payee);
  const creditAdded = payee && released.length ? await payProCredit(manager, job, payee, released[released.length - 1].id, actorUserId) : 0;
  const paymentStatus = await syncPaymentStatus(manager, job);
  return { released, paymentStatus, payeeUserId: payee, creditAdded };
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
  await ledger(manager, job, milestoneEntries(refunded, "refund", note), actorUserId, payee);
  const paymentStatus = await syncPaymentStatus(manager, job);
  // The client gets back what they paid; the credit-funded part goes back to their credit balance.
  const totalRefunded = roundRupees(refunded.reduce((s, m) => s + Number(m.amount) - Number(m.creditAmount || 0), 0));
  const creditReturned = roundRupees(refunded.reduce((s, m) => s + Number(m.creditAmount || 0), 0));
  // Credit follows the money: a refund takes back referral credit earned on this job.
  const creditNotices = refunded.length ? await reverseReferralRewards(manager, job.id, "refunded", actorUserId) : [];
  if (creditReturned > 0) await restoreClientCredit(manager, job.homeownerId, job.id, creditReturned);
  return { refunded, notRefundable, totalRefunded, creditReturned, paymentStatus, creditNotices };
}

/**
 * The hired professional called off the booking before starting: money already released to them
 * (the deposit) goes back. The client-funded part is returned to the client and the credit-funded
 * part to the client's credit balance.
 */
export async function clawBackReleased(manager: EntityManager, job: Job, actorUserId: string, note: string) {
  await lockJob(manager, job.id);
  const res = await manager
    .createQueryBuilder()
    .update(PaymentMilestone)
    .set({ status: MilestoneStatus.REFUNDED, refundedAt: () => "now()", refundedByUserId: actorUserId, refundNote: note.slice(0, 500) })
    .where(`"jobId" = :jobId AND "status" = :released`, { jobId: job.id, released: MilestoneStatus.RELEASED })
    .returning("*")
    .execute();
  const rows = (res.raw as PaymentMilestone[]).map((r) => manager.create(PaymentMilestone, r));
  if (!rows.length) return { clawedBack: 0, creditReturned: 0 };
  const payee = await payeeFor(manager, job);
  const entries = milestoneEntries(rows, "refund", note).map((e) => (e.type === LedgerType.REFUND ? { ...e, type: LedgerType.CLAWBACK } : e));
  await ledger(manager, job, entries, actorUserId, payee);
  const clawedBack = roundRupees(rows.reduce((s, m) => s + Number(m.amount) - Number(m.creditAmount || 0), 0));
  const credit = roundRupees(rows.reduce((s, m) => s + Number(m.creditAmount || 0), 0));
  const creditReturned = credit > 0 ? await restoreClientCredit(manager, job.homeownerId, job.id, credit) : 0;
  await syncPaymentStatus(manager, job);
  return { clawedBack, creditReturned };
}

/** A professional's referral credit is paid out with a release, through the provider and the ledger. */
async function payProCredit(manager: EntityManager, job: Job, proId: string, milestoneId: string, actorUserId: string | null) {
  const amount = await applyProCredit(manager, proId, job.id);
  if (amount > 0) {
    await ledger(
      manager,
      job,
      [{ type: LedgerType.CREDIT_PAYOUT, amount, milestoneId, note: "Your FixLocal credit", payerUserId: null }],
      actorUserId,
      proId
    );
  }
  return amount;
}

/**
 * Ledger rows that change what a professional has been paid, signed: payouts are positive; money paid
 * back (clawback, or the credit part of a released milestone that was clawed back) is negative.
 */
const EARNINGS_SQL = `
  SELECT l."jobId", l."createdAt",
         CASE WHEN l."type" IN ('clawback', 'credit_refund') THEN -l."amount" ELSE l."amount" END AS amount
    FROM "ledger_entries" l
   WHERE l."payeeUserId" = $1
     AND (l."type" = ANY($2) OR l."type" = 'clawback'
          OR (l."type" = 'credit_refund' AND EXISTS (
                SELECT 1 FROM "ledger_entries" r WHERE r."milestoneId" = l."milestoneId" AND r."type" = 'credit_release')))`;

/** Every payment to a professional, one row per ledger movement. */
export async function payoutRows(manager: EntityManager, payeeUserId: string) {
  const rows: { amount: string; createdAt: Date }[] = await manager.query(EARNINGS_SQL, [payeeUserId, [...PAYOUT_TYPES]]);
  return rows.map((r) => ({ amount: Number(r.amount), createdAt: new Date(r.createdAt) }));
}

/** Sum of everything paid to a professional per job (ledger is the source of truth). */
export async function releasedTotalsByJob(manager: EntityManager, payeeUserId: string) {
  const rows: { jobId: string; total: string; lastAt: Date }[] = await manager.query(
    `SELECT e."jobId", SUM(e.amount) AS total, MAX(e."createdAt") AS "lastAt" FROM (${EARNINGS_SQL}) e GROUP BY e."jobId"`,
    [payeeUserId, [...PAYOUT_TYPES]]
  );
  return new Map(rows.map((r) => [r.jobId, { total: Number(r.total), lastAt: new Date(r.lastAt) }]));
}
