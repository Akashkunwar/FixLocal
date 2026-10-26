import type { EntityManager } from "typeorm";
import { config } from "../config";
import { Bid } from "../entities/Bid";
import { CreditEntry, type CreditKind } from "../entities/CreditEntry";
import { Job, JobStatus } from "../entities/Job";
import { ReferralReward } from "../entities/ReferralReward";
import { User } from "../entities/User";
import { AuditAction, SYSTEM_ACTOR_ID, writeAudit } from "../utils/audit";
import { istParts } from "./time";
import type { NotificationInput } from "../utils/notifications";
import { NotificationType } from "../entities/Notification";

/**
 * FixLocal credit (simulated, like escrow).
 * - Earned: ₹REFERRAL_REWARD_INR each for the referrer and the referred user when the referred
 *   user's first job is confirmed complete.
 * - Used: a client's credit comes off what they fund at their next hire; a professional's credit is
 *   added to their next payout. (FixLocal charges no platform fee today, so the credit is applied to
 *   the payment itself; if a fee is introduced it should come off the fee instead.)
 * - Reversed: if that job is refunded or its dispute is lost, any unused part is taken back.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

async function lock(m: EntityManager, userId: string) {
  await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`credits:${userId}`]);
}

export async function creditBalance(m: EntityManager, userId: string): Promise<number> {
  const [row] = await m.query(`SELECT COALESCE(SUM("amount"), 0) AS "balance" FROM "credit_entries" WHERE "userId" = $1`, [userId]);
  return round2(Number(row.balance));
}

async function add(m: EntityManager, userId: string, kind: CreditKind, amount: number, extra: Partial<CreditEntry> = {}) {
  await m.insert(CreditEntry, { userId, kind, amount: round2(amount), ...extra });
}

/** Normalise an email for duplicate checks: case, Gmail dots and +tags. */
export function canonicalEmail(email: string): string {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  const base = local.split("+")[0];
  const gmail = domain === "gmail.com" || domain === "googlemail.com";
  return `${gmail ? base.replace(/\./g, "") : base}@${gmail ? "gmail.com" : domain}`;
}

const phoneKey = (p?: string | null) => (p || "").replace(/\D/g, "").slice(-10);

type Person = Pick<User, "id" | "email" | "phone" | "deletedAt" | "isSuspended" | "referredById"> & { signupDeviceHash?: string | null };

/** Why a referral must not pay out (null = fine). Pure, so it is unit-tested directly. */
export function selfReferralReason(referred: Person, referrer: Person | null, otherPartyId: string | null): string | null {
  if (!referrer || referrer.deletedAt || referrer.isSuspended) return "referrer_inactive";
  if (referrer.id === referred.id) return "same_account";
  if (otherPartyId && otherPartyId === referrer.id) return "self_dealing";
  if (canonicalEmail(referrer.email) === canonicalEmail(referred.email)) return "same_email";
  const a = phoneKey(referrer.phone);
  if (a.length === 10 && a === phoneKey(referred.phone)) return "same_phone";
  if (referrer.signupDeviceHash && referrer.signupDeviceHash === referred.signupDeviceHash) return "same_device";
  return null;
}

async function person(m: EntityManager, id: string): Promise<Person | null> {
  return m
    .createQueryBuilder(User, "u")
    .select(["u.id", "u.email", "u.phone", "u.deletedAt", "u.isSuspended", "u.referredById"])
    .addSelect("u.signupDeviceHash")
    .where("u.id = :id", { id })
    .getOne();
}

async function rewardsThisMonth(m: EntityManager, referrerId: string, now: Date): Promise<number> {
  const month = istParts(now).date.slice(0, 7);
  const [row] = await m.query(
    `SELECT COUNT(*)::int AS n FROM "referral_rewards"
      WHERE "referrerId" = $1 AND "status" IN ('granted', 'reversed') AND "referrerAmount" > 0
        AND to_char("createdAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') = $2`,
    [referrerId, month]
  );
  return row.n;
}

const firstName = (name?: string | null) => (name || "").trim().split(/\s+/)[0] || "Your friend";

/**
 * Called in the same transaction that confirms a job complete. Pays each party of the job who
 * joined through an invite, once per account, after the anti-abuse checks. Returns notifications
 * for the caller to send after commit.
 */
export async function grantReferralRewards(m: EntityManager, jobId: string, now = new Date()): Promise<NotificationInput[]> {
  const { rewardInr, monthlyCap, minJobInr } = config().referral;
  if (rewardInr <= 0) return [];
  const job = await m.findOne(Job, { where: { id: jobId } });
  if (!job || job.status !== JobStatus.COMPLETED || !job.acceptedBidId) return [];
  const [{ total }] = await m.query(
    `SELECT COALESCE(SUM("amount"), 0) AS total FROM "ledger_entries" WHERE "jobId" = $1 AND "type" = 'release'`,
    [jobId]
  );
  if (Number(total) < minJobInr) return [];
  const bid = await m.findOne(Bid, { where: { id: job.acceptedBidId }, select: { id: true, tradespersonId: true } });
  if (!bid) return [];
  const parties: [string, string][] = [
    [job.homeownerId, bid.tradespersonId],
    [bid.tradespersonId, job.homeownerId],
  ];
  const out: NotificationInput[] = [];
  for (const [partyId, otherId] of parties) {
    const referred = await person(m, partyId);
    if (!referred?.referredById) continue;
    if (await m.exists(ReferralReward, { where: { referredId: referred.id } })) continue;
    const referrer = await person(m, referred.referredById);
    const blocked = selfReferralReason(referred, referrer, otherId);
    const capped = !blocked && monthlyCap > 0 && (await rewardsThisMonth(m, referred.referredById, now)) >= monthlyCap;
    const referrerAmount = blocked || capped ? 0 : rewardInr;
    const referredAmount = blocked ? 0 : rewardInr;
    const inserted = await m
      .createQueryBuilder()
      .insert()
      .into(ReferralReward)
      .values({
        referrerId: referred.referredById,
        referredId: referred.id,
        jobId,
        status: blocked ? "blocked" : "granted",
        reason: blocked ?? (capped ? "monthly_cap" : null),
        referrerAmount,
        referredAmount,
      })
      .orIgnore()
      .returning(["id"])
      .execute();
    const rewardId: string | undefined = inserted.raw?.[0]?.id;
    if (!rewardId) continue; // a concurrent confirmation already decided this one
    await writeAudit(
      {
        actorUserId: SYSTEM_ACTOR_ID,
        actorEmail: "system",
        action: blocked ? AuditAction.REFERRAL_BLOCKED : AuditAction.REFERRAL_REWARD,
        targetType: "job",
        targetId: jobId,
        summary: blocked
          ? `Referral reward blocked (${blocked}) for user ${referred.id}`
          : `Referral reward: ₹${referredAmount} to user ${referred.id}, ₹${referrerAmount} to referrer ${referred.referredById}${capped ? " (referrer at monthly cap)" : ""}`,
        meta: { rewardId, referredId: referred.id, referrerId: referred.referredById, reason: blocked ?? (capped ? "monthly_cap" : null) },
      },
      m
    );
    if (blocked) continue;
    const names = await m.find(User, { where: [{ id: referred.id }, { id: referred.referredById }], select: { id: true, name: true } });
    const nameOf = (id: string) => names.find((u) => u.id === id)?.name;
    await lock(m, referred.id);
    await add(m, referred.id, "referral_reward", referredAmount, { jobId, rewardId, note: "Welcome reward: first job completed" });
    out.push({
      userId: referred.id,
      type: NotificationType.SYSTEM,
      title: "You earned FixLocal credit",
      body: `₹${referredAmount} credit for finishing your first job on FixLocal (you joined with ${firstName(nameOf(referred.referredById))}'s invite). It is used automatically at your next payment.`,
      link: "/settings#credit",
      meta: { rewardId, jobId },
    });
    if (referrerAmount > 0) {
      await lock(m, referred.referredById);
      await add(m, referred.referredById, "referral_reward", referrerAmount, { jobId, rewardId, note: `${firstName(nameOf(referred.id))} finished their first job` });
      out.push({
        userId: referred.referredById,
        type: NotificationType.SYSTEM,
        title: "You earned FixLocal credit",
        body: `₹${referrerAmount} credit: ${firstName(nameOf(referred.id))}, who joined with your invite, finished their first job. It is used automatically at your next payment.`,
        link: "/settings#credit",
        meta: { rewardId, jobId },
      });
    }
  }
  return out;
}

/** Take back any unused reward credit tied to this job (refund, or a dispute lost). */
export async function reverseReferralRewards(m: EntityManager, jobId: string, reason: string, actorUserId: string | null) {
  const rewards = await m.find(ReferralReward, { where: { jobId, status: "granted" } });
  const out: NotificationInput[] = [];
  for (const r of rewards) {
    const claimed = await m.update(ReferralReward, { id: r.id, status: "granted" }, { status: "reversed", reason, reversedAt: new Date() });
    if (!claimed.affected) continue;
    const sides: [string | null | undefined, number][] = [
      [r.referredId, Number(r.referredAmount)],
      [r.referrerId, Number(r.referrerAmount)],
    ];
    const taken: Record<string, number> = {};
    for (const [userId, amount] of sides) {
      if (!userId || !(amount > 0)) continue;
      await lock(m, userId);
      const take = Math.min(amount, Math.max(0, await creditBalance(m, userId)));
      taken[userId] = take;
      if (take > 0) {
        await add(m, userId, "reversal", -take, {
          jobId,
          rewardId: r.id,
          note: take < amount ? `Referral reward reversed (₹${amount - take} had already been used)` : "Referral reward reversed",
        });
      }
      out.push({
        userId,
        type: NotificationType.SYSTEM,
        title: "Referral credit reversed",
        body: `The job that earned a ₹${amount} referral credit was ${reason === "dispute_lost" ? "lost in a dispute" : "refunded"}, so ₹${take} unused credit was removed.`,
        link: "/settings#credit",
        meta: { rewardId: r.id, jobId },
      });
    }
    await writeAudit(
      {
        actorUserId: actorUserId ?? SYSTEM_ACTOR_ID,
        actorEmail: actorUserId ? undefined : "system",
        action: AuditAction.REFERRAL_REVERSED,
        targetType: "job",
        targetId: jobId,
        summary: `Referral reward ${r.id} reversed (${reason})`,
        meta: { rewardId: r.id, reason, taken },
      },
      m
    );
  }
  return out;
}

/** At hire: the client's credit comes off the amount they fund (the platform covers it). */
export async function applyClientCredit(m: EntityManager, clientId: string, jobId: string, escrowAmount: number) {
  if (!(escrowAmount > 0)) return 0;
  await lock(m, clientId);
  const use = round2(Math.min(await creditBalance(m, clientId), escrowAmount));
  if (use <= 0) return 0;
  await add(m, clientId, "applied_payment", -use, { jobId, note: "Used at hire: you funded this much less" });
  return use;
}

/** At a release: the professional's credit is added to the payout. */
export async function applyProCredit(m: EntityManager, proId: string, jobId: string) {
  await lock(m, proId);
  const use = await creditBalance(m, proId);
  if (use <= 0) return 0;
  await add(m, proId, "applied_payout", -use, { jobId, note: "Added to your payout" });
  return use;
}

/** A hire that ends fully refunded gives the client back the credit it used. */
export async function restoreClientCredit(m: EntityManager, clientId: string, jobId: string) {
  await lock(m, clientId);
  const [row] = await m.query(
    `SELECT COALESCE(SUM(CASE WHEN "kind" = 'applied_payment' THEN -"amount" WHEN "kind" = 'restored' THEN -"amount" ELSE 0 END), 0) AS open
       FROM "credit_entries" WHERE "userId" = $1 AND "jobId" = $2`,
    [clientId, jobId]
  );
  const open = round2(Number(row.open));
  if (open > 0) await add(m, clientId, "restored", open, { jobId, note: "Hire cancelled: credit returned" });
  return open;
}

/** Credit used on one job, for the payment panel. */
export async function creditUsedOnJob(m: EntityManager, userId: string, jobId: string) {
  const [row] = await m.query(
    `SELECT COALESCE(SUM(CASE WHEN "kind" = 'applied_payment' THEN -"amount" ELSE 0 END), 0) AS payment,
            COALESCE(SUM(CASE WHEN "kind" = 'restored' THEN "amount" ELSE 0 END), 0) AS restored,
            COALESCE(SUM(CASE WHEN "kind" = 'applied_payout' THEN -"amount" ELSE 0 END), 0) AS payout
       FROM "credit_entries" WHERE "userId" = $1 AND "jobId" = $2`,
    [userId, jobId]
  );
  return { appliedToPayment: round2(Number(row.payment) - Number(row.restored)), addedToPayout: round2(Number(row.payout)) };
}
