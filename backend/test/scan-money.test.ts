import { afterEach, describe, expect, it, vi } from "vitest";
import { Repository } from "typeorm";
import { AppDataSource } from "../src/data-source";
import { config, overrideConfig } from "../src/config";
import { Job } from "../src/entities/Job";
import { autoConfirmJobs } from "../src/workers";
import { acceptBid, admin, api, awardedJob, createJob, placeBid, pro, rows, type TestUser } from "./helpers";

const balance = async (u: TestUser) => (await api().get("/api/credits/me").set(u.auth)).body.credits.balance as number;
const refer = (referred: TestUser, referrer: TestUser) =>
  AppDataSource.query(`UPDATE "users" SET "referredById" = $1, "phone" = NULL WHERE "id" = $2`, [
    referrer.user.id,
    referred.user.id,
  ]);
const ledgerSum = async (jobId: string, type: string, extra = "", params: unknown[] = []) =>
  Number(
    (
      await rows<{ s: string | null }>(
        `SELECT SUM("amount") s FROM "ledger_entries" WHERE "jobId"=$1 AND "type"=$2 ${extra}`,
        [jobId, type, ...params]
      )
    )[0].s ?? 0
  );
const milestones = async (owner: TestUser, jobId: string) =>
  (await api().get(`/api/jobs/${jobId}/payments`).set(owner.auth)).body.milestones;

describe("money scan regressions", () => {
  const original = { ...config().referral };
  afterEach(() => {
    overrideConfig({ referral: { ...original } });
    vi.restoreAllMocks();
  });

  /** A client with ₹100 referral credit, and a second job of theirs with a ₹1500 hire. */
  async function hireWithCredit() {
    const inviter = await pro();
    const first = await awardedJob({ stage: "pending_confirmation", amount: 1200 });
    await refer(first.owner, inviter);
    await api().post(`/api/jobs/${first.job.id}/confirm`).set(first.owner.auth).expect(200);
    expect(await balance(first.owner)).toBe(100);
    const job2 = await createJob(first.owner);
    const bid2 = await placeBid(first.worker, job2.id, { amount: 1500 });
    expect((await acceptBid(first.owner, bid2.id)).status).toBe(200);
    return { owner: first.owner, worker: first.worker, jobId: job2.id };
  }

  it("R1 credit used at hire: the client funds only their part, and a full refund returns each part once", async () => {
    const { owner, jobId } = await hireWithCredit();
    const pay = await api().get(`/api/jobs/${jobId}/payments`).set(owner.auth);
    expect(pay.body.credit.appliedToPayment).toBe(100);
    expect(await ledgerSum(jobId, "hold", `AND "payerUserId"=$3`, [owner.user.id])).toBe(1400);
    expect(await ledgerSum(jobId, "credit_hold")).toBe(100);
    expect(await balance(owner)).toBe(0);

    await api().post(`/api/jobs/${jobId}/cancel-booking`).set(owner.auth).send({}).expect(200);
    expect(await ledgerSum(jobId, "refund")).toBe(1400);
    expect(await ledgerSum(jobId, "credit_refund")).toBe(100);
    expect(await balance(owner)).toBe(100);
    const sp = (await api().get("/api/jobs/spending").set(owner.auth)).body.spending.totals;
    expect(sp.inEscrow).toBe(0);
  });

  it("R1 a partial refund returns the credit only for the part credit funded", async () => {
    const { owner, worker, jobId } = await hireWithCredit();
    const ms = await milestones(owner, jobId);
    await api().post(`/api/jobs/${jobId}/start`).set(worker.auth).send({});
    await api().post(`/api/jobs/${jobId}/payments/${ms[0].id}/release`).set(owner.auth).expect(200);
    // Deposit (₹450: ₹100 credit + ₹350 client) went to the pro; the rest is refunded by a ruling.
    expect(await ledgerSum(jobId, "release")).toBe(350);
    expect(await ledgerSum(jobId, "credit_release")).toBe(100);
    const d = await api().post(`/api/jobs/${jobId}/disputes`).set(owner.auth).field("reason", "Work abandoned halfway");
    await api()
      .patch(`/api/disputes/${d.body.dispute.id}/resolve`)
      .set((await admin()).auth)
      .send({ resolution: "favor_homeowner" })
      .expect(200);
    expect(await ledgerSum(jobId, "refund")).toBe(1050);
    expect(await balance(owner)).toBe(0); // the credit was spent on the released deposit
    const earned = (await api().get("/api/profile/analytics").set(worker.auth)).body.analytics.earningsOverTime as {
      amount: number;
    }[];
    expect(earned.reduce((s, m) => s + m.amount, 0)).toBeGreaterThanOrEqual(450);
  });

  it("R1 a pro's own credit is paid out through the ledger and counts as earnings", async () => {
    const inviter = await pro();
    const first = await awardedJob({ stage: "pending_confirmation", amount: 1200 });
    await refer(first.worker, inviter);
    await api().post(`/api/jobs/${first.job.id}/confirm`).set(first.owner.auth).expect(200);
    const credit = await balance(first.worker);
    expect(credit).toBe(100);
    const second = await createJob(first.owner);
    const bid = await placeBid(first.worker, second.id, { amount: 1000 });
    await acceptBid(first.owner, bid.id);
    const ms = await milestones(first.owner, second.id);
    await api().post(`/api/jobs/${second.id}/payments/${ms[0].id}/release`).set(first.owner.auth).expect(200);
    expect(await ledgerSum(second.id, "credit_payout", `AND "payeeUserId"=$3`, [first.worker.user.id])).toBe(100);
    expect(await balance(first.worker)).toBe(0);
  });

  it("R2 monthly referral cap holds under concurrent confirmations", async () => {
    overrideConfig({ referral: { ...original, monthlyCap: 1 } });
    const capper = await pro();
    const jobs = await Promise.all([0, 1, 2, 3].map(() => awardedJob({ stage: "pending_confirmation" })));
    for (const j of jobs) await refer(j.owner, capper);
    const res = await Promise.all(jobs.map((j) => api().post(`/api/jobs/${j.job.id}/confirm`).set(j.owner.auth)));
    expect(res.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const granted = await rows(`SELECT 1 FROM "referral_rewards" WHERE "referrerId"=$1 AND "referrerAmount">0`, [
      capper.user.id,
    ]);
    expect(granted.length).toBe(1);
  });

  it("R3 pro earnings count each payment in the month it was released", async () => {
    const { owner, worker, job } = await awardedJob({ stage: "in_progress", amount: 1000 });
    const ms = await milestones(owner, job.id);
    await api().post(`/api/jobs/${job.id}/payments/${ms[0].id}/release`).set(owner.auth).expect(200);
    await AppDataSource.query(
      `UPDATE "ledger_entries" SET "createdAt" = now() - interval '62 days' WHERE "milestoneId"=$1 AND "type"='release'`,
      [ms[0].id]
    );
    await api().post(`/api/jobs/${job.id}/mark-done`).set(worker.auth).expect(200);
    await api().post(`/api/jobs/${job.id}/confirm`).set(owner.auth).expect(200);
    const months = (await api().get("/api/profile/analytics").set(worker.auth)).body.analytics.earningsOverTime as {
      amount: number;
    }[];
    const nonZero = months.filter((m) => m.amount > 0).map((m) => m.amount);
    expect(nonZero).toEqual([300, 700]);
  });

  it("R4 auto-confirm re-checks the confirmation window under the lock", async () => {
    const { job } = await awardedJob({ stage: "pending_confirmation" });
    const stale = await AppDataSource.getRepository(Job).findOneByOrFail({ id: job.id });
    // The worker read the job as overdue, but the window has since been restarted.
    vi.spyOn(Repository.prototype, "find").mockResolvedValueOnce([stale]);
    const later = new Date(Date.now() + (config().autoConfirmDays + 1) * 86400_000);
    await AppDataSource.query(`UPDATE "jobs" SET "pendingConfirmationAt" = $2 WHERE "id" = $1`, [job.id, later]);
    await autoConfirmJobs(later);
    const [row] = await rows<{ status: string }>(`SELECT "status" FROM "jobs" WHERE "id"=$1`, [job.id]);
    expect(row.status).toBe("pending_confirmation");
  });

  it("R5 a ruling can't move the money against the side it favours", async () => {
    const { owner, job } = await awardedJob({ stage: "in_progress", amount: 1000 });
    const d = await api()
      .post(`/api/jobs/${job.id}/disputes`)
      .set(owner.auth)
      .field("reason", "Work abandoned halfway");
    const a = (await admin()).auth;
    const r1 = await api()
      .patch(`/api/disputes/${d.body.dispute.id}/resolve`)
      .set(a)
      .send({ resolution: "favor_homeowner", jobStatus: "completed" });
    expect(r1.status).toBe(400);
    expect(r1.body.code).toBe("RESOLUTION_MISMATCH");
    const r2 = await api()
      .patch(`/api/disputes/${d.body.dispute.id}/resolve`)
      .set(a)
      .send({ resolution: "favor_tradesperson", jobStatus: "cancelled" });
    expect(r2.body.code).toBe("RESOLUTION_MISMATCH");
    expect(await ledgerSum(job.id, "release")).toBe(0);
  });

  it("R6 a fully refunded job can't be put back to work with a 'no action' ruling", async () => {
    const { owner, job } = await awardedJob({ stage: "in_progress", amount: 1000 });
    const ms = await milestones(owner, job.id);
    const d = await api()
      .post(`/api/jobs/${job.id}/disputes`)
      .set(owner.auth)
      .field("reason", "Work abandoned halfway");
    const res = await api()
      .patch(`/api/disputes/${d.body.dispute.id}/resolve`)
      .set((await admin()).auth)
      .send({ resolution: "no_action", refundMilestoneIds: ms.map((m: { id: string }) => m.id) });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("FULLY_REFUNDED");
    const [row] = await rows<{ status: string }>(`SELECT "status" FROM "jobs" WHERE "id"=$1`, [job.id]);
    expect(row.status).toBe("disputed");
  });

  it("R8 a pro who cancels before starting gives back a released deposit", async () => {
    const { owner, worker, job } = await awardedJob({ stage: "awarded", amount: 1000 });
    const ms = await milestones(owner, job.id);
    await api().post(`/api/jobs/${job.id}/payments/${ms[0].id}/release`).set(owner.auth).expect(200);
    const res = await api().post(`/api/jobs/${job.id}/cancel-booking`).set(worker.auth).send({}).expect(200);
    expect(res.body.refunded).toBe(1000);
    expect(res.body.paymentStatus).toBe("refunded");
    expect(await ledgerSum(job.id, "clawback")).toBe(300);
    const totals = (await api().get("/api/jobs/spending").set(owner.auth)).body.spending.totals;
    expect(totals.paid).toBe(0);
    expect(totals.refunded).toBe(1000);
    const earned = (await api().get("/api/profile/analytics").set(worker.auth)).body.analytics.earningsOverTime as {
      amount: number;
    }[];
    expect(earned.reduce((s, m) => s + m.amount, 0)).toBe(0);
  });

  it("R8 a client who cancels leaves the released deposit with the pro", async () => {
    const { owner, job } = await awardedJob({ stage: "awarded", amount: 1000 });
    const ms = await milestones(owner, job.id);
    await api().post(`/api/jobs/${job.id}/payments/${ms[0].id}/release`).set(owner.auth).expect(200);
    const res = await api().post(`/api/jobs/${job.id}/cancel-booking`).set(owner.auth).send({}).expect(200);
    expect(res.body.refunded).toBe(700);
    expect(await ledgerSum(job.id, "clawback")).toBe(0);
  });

  it("escrow amounts below ₹10 are refused, so no milestone rounds to ₹0", async () => {
    const owner = (await awardedJob()).owner;
    const job = await createJob(owner);
    const res = await api()
      .post(`/api/jobs/${job.id}/bids`)
      .set((await pro()).auth)
      .send({ amount: 0.02 });
    expect(res.status).toBe(400);
  });

  it("each milestone records each kind of movement once (unique ledger index)", async () => {
    const { owner, job } = await awardedJob();
    const ms = await milestones(owner, job.id);
    await expect(
      AppDataSource.query(
        `INSERT INTO "ledger_entries" ("jobId","milestoneId","type","amount") VALUES ($1,$2,'hold',1)`,
        [job.id, ms[0].id]
      )
    ).rejects.toThrow(/UQ_ledger_milestone_type|duplicate key/);
  });
});
