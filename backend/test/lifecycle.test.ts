import { describe, expect, it } from "vitest";
import { admin, api, awardedJob, client, createJob, pro, rows } from "./helpers";
import { runWorkersOnce } from "../src/workers";
import { AppDataSource } from "../src/data-source";

const milestones = async (jobId: string) =>
  rows<{ id: string; sequence: number; status: string; amount: string }>(
    `SELECT "id", "sequence", "status", "amount" FROM "payment_milestones" WHERE "jobId" = $1 ORDER BY "sequence"`,
    [jobId]
  );
const jobRow = async (jobId: string) =>
  (await rows<{ status: string; paymentStatus: string; completedAt: Date | null }>(
    `SELECT "status", "paymentStatus", "completedAt" FROM "jobs" WHERE "id" = $1`,
    [jobId]
  ))[0];

describe("work lifecycle (H-6)", () => {
  it("pro marks done → client confirms → remaining escrow released", async () => {
    const { owner, worker, job } = await awardedJob({ stage: "in_progress" });
    const done = await api().post(`/api/jobs/${job.id}/complete`).set(worker.auth);
    expect(done.status).toBe(200);
    expect(done.body.job.status).toBe("pending_confirmation");
    const note = await api().get("/api/notifications").set(owner.auth);
    expect(note.body.notifications[0].title).toMatch(/confirm/i);

    const confirm = await api().post(`/api/jobs/${job.id}/complete`).set(owner.auth);
    expect(confirm.status).toBe(200);
    expect(confirm.body.job.status).toBe("completed");
    expect(confirm.body.autoReleased).toMatchObject({ count: 3, paymentStatus: "released" });
    expect((await milestones(job.id)).map((m) => m.status)).toEqual(["released", "released", "released"]);

    const earnings = await api().get("/api/profile/earnings").set(worker.auth);
    expect(earnings.body.earnings.totalEarned).toBe(1000);
  });

  it("enforces the transition table", async () => {
    const { owner, worker, job } = await awardedJob();
    expect((await api().post(`/api/jobs/${job.id}/mark-done`).set(worker.auth)).status).toBe(409);
    expect((await api().post(`/api/jobs/${job.id}/start`).set(owner.auth)).status).toBe(403);
    const other = await pro();
    expect((await api().post(`/api/jobs/${job.id}/start`).set(other.auth)).status).toBe(403);
    await api().post(`/api/jobs/${job.id}/start`).set(worker.auth).expect(200);
    expect((await api().post(`/api/jobs/${job.id}/start`).set(worker.auth)).status).toBe(409);
    expect((await api().post(`/api/jobs/${job.id}/cancel`).set(owner.auth)).status).toBe(409);
    expect((await api().post(`/api/jobs/${job.id}/confirm`).set(worker.auth)).status).toBe(403);
  });

  it("a client can confirm straight from awarded (releases everything)", async () => {
    const { owner, job } = await awardedJob();
    const res = await api().post(`/api/jobs/${job.id}/confirm`).set(owner.auth);
    expect(res.status).toBe(200);
    expect((await jobRow(job.id)).paymentStatus).toBe("released");
  });

  it("auto-confirms after the waiting period", async () => {
    const { worker, job } = await awardedJob({ stage: "pending_confirmation" });
    await AppDataSource.query(`UPDATE "jobs" SET "pendingConfirmationAt" = now() - interval '4 days' WHERE "id" = $1`, [job.id]);
    const result = await runWorkersOnce();
    expect(result).toMatchObject({ skipped: false, autoConfirmed: 1 });
    const row = await jobRow(job.id);
    expect(row.status).toBe("completed");
    expect(row.paymentStatus).toBe("released");
    const audit = await rows(`SELECT 1 FROM "audit_logs" WHERE "action" = 'auto_confirm' AND "targetId" = $1`, [job.id]);
    expect(audit).toHaveLength(1);
    const notes = await api().get("/api/notifications").set(worker.auth);
    expect(notes.body.notifications[0].meta.autoConfirmed).toBe(true);
    expect((await runWorkersOnce()).autoConfirmed).toBe(0);
  });
});

describe("milestone releases (C-5)", () => {
  it("releases in order, once, even under concurrency", async () => {
    for (let round = 0; round < 20; round++) {
      const { owner, worker, job } = await awardedJob();
      const [m1, m2] = await milestones(job.id);
      const outOfOrder = await api().post(`/api/jobs/${job.id}/payments/${m2.id}/release`).set(owner.auth);
      expect(outOfOrder.body.code).toBe("OUT_OF_ORDER");
      const results = await Promise.all(
        Array.from({ length: 5 }, () => api().post(`/api/jobs/${job.id}/payments/${m1.id}/release`).set(owner.auth))
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      const [{ n }] = await rows<{ n: string }>(
        `SELECT COUNT(*) n FROM "ledger_entries" WHERE "milestoneId" = $1 AND "type" = 'release'`,
        [m1.id]
      );
      expect(n).toBe("1");
      if (round === 0) {
        const notes = await api().get("/api/notifications").set(worker.auth);
        expect(notes.body.notifications.filter((x: { meta: { milestoneId?: string } }) => x.meta?.milestoneId === m1.id)).toHaveLength(1);
        const statuses = (await milestones(job.id)).map((m) => m.status);
        expect(statuses).toEqual(["released", "held", "pending"]);
        expect((await jobRow(job.id)).paymentStatus).toBe("partially_released");
      }
    }
  });

  it("only the client or an admin can release, and only for this job's milestones", async () => {
    const { worker, job } = await awardedJob();
    const other = await awardedJob();
    const [m1] = await milestones(job.id);
    expect((await api().post(`/api/jobs/${job.id}/payments/${m1.id}/release`).set(worker.auth)).status).toBe(403);
    expect((await api().post(`/api/jobs/${other.job.id}/payments/${m1.id}/release`).set(other.owner.auth)).status).toBe(404);
    const a = await admin();
    expect((await api().post(`/api/jobs/${job.id}/payments/${m1.id}/release`).set(a.auth)).status).toBe(200);
  });

  it("payments are visible only to the parties", async () => {
    const { owner, worker, job } = await awardedJob();
    expect((await api().get(`/api/jobs/${job.id}/payments`).set(owner.auth)).status).toBe(200);
    expect((await api().get(`/api/jobs/${job.id}/payments`).set(worker.auth)).status).toBe(200);
    expect((await api().get(`/api/jobs/${job.id}/payments`).set((await pro()).auth)).status).toBe(403);
    expect((await api().get(`/api/jobs/${job.id}/payments`).set((await client()).auth)).status).toBe(403);
  });
});

describe("disputes (H-6, M-7)", () => {
  const open = (u: { auth: Record<string, string> }, jobId: string, reason = "Work left unfinished") =>
    api().post(`/api/jobs/${jobId}/disputes`).set(u.auth).field("reason", reason);

  it("'no action' restores the previous status and leaves money alone", async () => {
    const { owner, job } = await awardedJob({ stage: "in_progress" });
    const d = await open(owner, job.id);
    expect(d.status).toBe(201);
    expect(d.body.dispute.previousJobStatus).toBe("in_progress");
    expect(d.body.job.status).toBe("disputed");
    const a = await admin();
    const res = await api().patch(`/api/disputes/${d.body.dispute.id}/resolve`).set(a.auth).send({ resolution: "no_action" });
    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe("in_progress");
    expect((await milestones(job.id)).map((m) => m.status)).toEqual(["held", "pending", "pending"]);
    expect((await api().patch(`/api/disputes/${d.body.dispute.id}/resolve`).set(a.auth).send({ resolution: "no_action" })).status).toBe(409);
  });

  it("'favor client' cancels and refunds everything not yet released", async () => {
    const { owner, worker, job } = await awardedJob({ stage: "in_progress" });
    const [m1] = await milestones(job.id);
    await api().post(`/api/jobs/${job.id}/payments/${m1.id}/release`).set(owner.auth).expect(200);
    const d = await open(worker, job.id, "Client won't pay the rest");
    const a = await admin();
    const res = await api()
      .patch(`/api/disputes/${d.body.dispute.id}/resolve`)
      .set(a.auth)
      .send({ resolution: "favor_homeowner", resolutionNotes: "Work not delivered" });
    expect(res.body.job).toMatchObject({ status: "cancelled", paymentStatus: "partially_released" });
    expect(res.body.dispute.refundMeta).toMatchObject({ totalRefunded: 700, milestoneIds: expect.any(Array) });
    expect((await milestones(job.id)).map((m) => m.status)).toEqual(["released", "refunded", "refunded"]);
    const earnings = await api().get("/api/profile/earnings").set(worker.auth);
    expect(earnings.body.earnings.totalEarned).toBe(300);
  });

  it("'favor pro' completes and releases the rest", async () => {
    const { owner, job } = await awardedJob({ stage: "pending_confirmation" });
    const d = await open(owner, job.id);
    const a = await admin();
    const res = await api().patch(`/api/disputes/${d.body.dispute.id}/resolve`).set(a.auth).send({ resolution: "favor_tradesperson" });
    expect(res.body.job).toMatchObject({ status: "completed", paymentStatus: "released" });
    expect(res.body.dispute.refundMeta.totalReleased).toBe(1000);
  });

  it("refuses to refund money that was already released", async () => {
    const { owner, job } = await awardedJob({ stage: "in_progress" });
    const [m1] = await milestones(job.id);
    await api().post(`/api/jobs/${job.id}/payments/${m1.id}/release`).set(owner.auth).expect(200);
    const d = await open(owner, job.id);
    const a = await admin();
    const res = await api()
      .patch(`/api/disputes/${d.body.dispute.id}/resolve`)
      .set(a.auth)
      .send({ resolution: "no_action", refundMilestoneIds: [m1.id] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ALREADY_RELEASED");
    // The failed resolution rolled back entirely.
    const [row] = await rows<{ status: string }>(`SELECT "status" FROM "disputes" WHERE "id" = $1`, [d.body.dispute.id]);
    expect(row.status).toBe("open");
  });

  it("allows one open dispute, only by the parties, only on eligible jobs", async () => {
    const { owner, worker, job } = await awardedJob();
    expect((await open(await client(), job.id)).status).toBe(403);
    expect((await open(await pro(), job.id)).status).toBe(403);
    const results = await Promise.all([open(owner, job.id), open(worker, job.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const openJob = await createJob(owner);
    expect((await open(owner, openJob.id)).status).toBe(409);
  });

  it("closes the dispute window 14 days after completion", async () => {
    const { owner, job } = await awardedJob({ stage: "completed" });
    await AppDataSource.query(`UPDATE "jobs" SET "completedAt" = now() - interval '20 days' WHERE "id" = $1`, [job.id]);
    const res = await open(owner, job.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DISPUTE_WINDOW_CLOSED");
  });

  it("the legacy JSON route still works, but not for file uploads", async () => {
    const { owner, job } = await awardedJob();
    const multipart = await api().post("/api/disputes").set(owner.auth).field("jobId", job.id).field("reason", "x");
    expect(multipart.body.code).toBe("USE_JOB_DISPUTE_ROUTE");
    const json = await api().post("/api/disputes").set(owner.auth).send({ jobId: job.id, reason: "Late", evidenceUrls: ["javascript:alert(1)"] });
    expect(json.status).toBe(201);
    expect(json.body.dispute.evidenceUrls).toEqual([]);
  });

  it("lists disputes for parties and admins only", async () => {
    const { owner, worker, job } = await awardedJob();
    await open(owner, job.id);
    const outsider = await client();
    expect((await api().get("/api/disputes").set(outsider.auth)).body.disputes).toHaveLength(0);
    expect((await api().get("/api/disputes").set(worker.auth)).body.disputes.some((d: { jobId: string }) => d.jobId === job.id)).toBe(true);
    const a = await admin();
    const all = await api().get("/api/disputes?status=open").set(a.auth);
    expect(all.body.disputes.length).toBeGreaterThan(0);
    expect(JSON.stringify(all.body)).not.toContain(owner.user.email);
  });
});

describe("reviews", () => {
  it("both sides review once after completion; ratings update", async () => {
    const { owner, worker, job } = await awardedJob({ stage: "in_progress" });
    expect((await api().post("/api/reviews").set(owner.auth).send({ jobId: job.id, rating: 5 })).status).toBe(409);
    await api().post(`/api/jobs/${job.id}/mark-done`).set(worker.auth).expect(200);
    await api().post(`/api/jobs/${job.id}/confirm`).set(owner.auth).expect(200);

    expect((await api().post("/api/reviews").set(owner.auth).send({ jobId: job.id, rating: 4, comment: "Good" })).status).toBe(201);
    expect((await api().post("/api/reviews").set(owner.auth).send({ jobId: job.id, rating: 5 })).status).toBe(409);
    expect((await api().post("/api/reviews").set(worker.auth).send({ jobId: job.id, rating: 5, comment: "Clear brief" })).status).toBe(201);
    expect((await api().post("/api/reviews").set(await pro().then((p) => p.auth)).send({ jobId: job.id, rating: 1 })).status).toBe(403);

    const pub = await api().get(`/api/profile/user/${worker.user.id}`).set((await client()).auth);
    expect(pub.body.profile).toMatchObject({ averageRating: 4, reviewCount: 1 });
    expect(pub.body.reviews[0]).toMatchObject({ rating: 4, reviewerName: owner.user.name });
    const clientReviews = await api().get(`/api/reviews/client/${owner.user.id}`).set(worker.auth);
    expect(clientReviews.body).toMatchObject({ reviewCount: 1, averageRating: 5 });

    const jobReviews = await api().get(`/api/reviews/job/${job.id}`).set(owner.auth);
    expect(jobReviews.body.review.rating).toBe(4);
    expect(jobReviews.body.proReview.rating).toBe(5);
    expect(JSON.stringify(jobReviews.body)).not.toContain(owner.user.email);
  });

  it("strangers can't read a job's reviews (C-2)", async () => {
    const { job } = await awardedJob({ stage: "completed" });
    const stranger = await pro();
    expect((await api().get(`/api/reviews/job/${job.id}`).set(stranger.auth)).status).toBe(403);
  });
});

describe("schedule and recurring packages", () => {
  it("parties propose and accept visits; strangers can't see the schedule (H-4)", async () => {
    const { owner, worker, job } = await awardedJob();
    const start = new Date(Date.now() + 86400_000).toISOString();
    expect((await api().post(`/api/jobs/${job.id}/schedule/propose`).set(owner.auth).send({ start: "2001-01-01" })).status).toBe(400);
    await api().post(`/api/jobs/${job.id}/schedule/propose`).set(owner.auth).send({ start, note: "Ring the bell" }).expect(200);
    expect((await api().post(`/api/jobs/${job.id}/schedule/accept`).set(owner.auth)).body.code).toBe("CANNOT_SELF_ACCEPT");
    const accepted = await api().post(`/api/jobs/${job.id}/schedule/accept`).set(worker.auth);
    expect(accepted.body.job.scheduleStatus).toBe("confirmed");

    const stranger = await pro();
    expect((await api().get(`/api/jobs/${job.id}/schedule`).set(stranger.auth)).status).toBe(403);
    expect((await api().get(`/api/jobs/${job.id}/schedule`).set(worker.auth)).body.schedule.note).toBe("Ring the bell");
  });

  it("an open job's preferred window is visible to verified pros but not the visit details", async () => {
    const owner = await client();
    const job = await createJob(owner, { preferredStart: "2026-12-01", preferredEnd: "2026-12-05" });
    const res = await api().get(`/api/jobs/${job.id}/schedule`).set((await pro()).auth);
    expect(res.body.schedule.preferredStart).toBeTruthy();
    expect(res.body.schedule.status).toBeNull();
  });

  it("recurring package proposals flow both ways", async () => {
    const { owner, worker, job } = await awardedJob();
    const proposal = { cadence: "monthly", packageLabel: "Monthly check", amountMin: 500, amountMax: 400 };
    expect((await api().post(`/api/jobs/${job.id}/amc-proposal`).set(worker.auth).send(proposal)).status).toBe(400);
    await api().post(`/api/jobs/${job.id}/amc-proposal`).set(worker.auth).send({ ...proposal, amountMax: 800 }).expect(200);
    expect((await api().post(`/api/jobs/${job.id}/amc-proposal`).set(owner.auth).send(proposal)).status).toBe(403);
    const reply = await api().post(`/api/jobs/${job.id}/amc-proposal/reply`).set(owner.auth).send({ action: "counter", replyNote: "Quarterly?" });
    expect(reply.body.job.amcProposal.status).toBe("countered");
    await api().post(`/api/jobs/${job.id}/amc-request`).set(owner.auth).send({ cadence: "weekly", packageLabel: "Weekly", amountMin: 300 }).expect(200);
    const answer = await api().post(`/api/jobs/${job.id}/amc-request/reply`).set(worker.auth).send({ action: "accept", amountMin: 350 });
    expect(answer.body.job.amcProposal).toMatchObject({ status: "accepted", amountMin: 350 });
  });
});
