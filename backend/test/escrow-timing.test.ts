import { describe, expect, it } from "vitest";
import { admin, api, awardedJob, client, createJob, placeBid, rows } from "./helpers";
import { runWorkersOnce } from "../src/workers";
import { AppDataSource } from "../src/data-source";
import { milestoneReleaseBlock } from "../src/domain/escrow";
import { JobStatus } from "../src/entities/Job";

const milestones = async (jobId: string) =>
  rows<{ id: string; sequence: number; status: string }>(
    `SELECT "id", "sequence", "status" FROM "payment_milestones" WHERE "jobId" = $1 ORDER BY "sequence"`,
    [jobId]
  );
const release = (auth: Record<string, string>, jobId: string, milestoneId: string) =>
  api().post(`/api/jobs/${jobId}/payments/${milestoneId}/release`).set(auth);

describe("escrow timing: money follows the work", () => {
  it("unit: each milestone unlocks at its stage; disputes freeze everything", () => {
    expect(milestoneReleaseBlock(1, 3, JobStatus.AWARDED)).toBeNull();
    expect(milestoneReleaseBlock(2, 3, JobStatus.AWARDED)?.code).toBe("TOO_EARLY");
    expect(milestoneReleaseBlock(2, 3, JobStatus.IN_PROGRESS)).toBeNull();
    expect(milestoneReleaseBlock(3, 3, JobStatus.IN_PROGRESS)?.code).toBe("TOO_EARLY");
    expect(milestoneReleaseBlock(3, 3, JobStatus.PENDING_CONFIRMATION)).toBeNull();
    expect(milestoneReleaseBlock(3, 3, JobStatus.COMPLETED)).toBeNull();
    for (const seq of [1, 2, 3]) {
      expect(milestoneReleaseBlock(seq, 3, JobStatus.DISPUTED)?.code).toBe("DISPUTED");
      expect(milestoneReleaseBlock(seq, 3, JobStatus.CANCELLED)?.code).toBe("INVALID_STATUS");
    }
    // A legacy single-milestone escrow is releasable as soon as a pro is hired.
    expect(milestoneReleaseBlock(1, 1, JobStatus.AWARDED)).toBeNull();
  });

  it("the completion payment can't be released before the pro marks the work done", async () => {
    const { owner, worker, job } = await awardedJob();
    const [m1, m2, m3] = await milestones(job.id);
    await release(owner.auth, job.id, m1.id).expect(200);

    const early = await release(owner.auth, job.id, m2.id);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("TOO_EARLY");

    const listed = await api().get(`/api/jobs/${job.id}/payments`).set(owner.auth);
    expect(listed.body.milestones.map((m: { releaseBlockedReason: string | null }) => m.releaseBlockedReason)).toEqual([
      null,
      expect.stringMatching(/starts work/),
      expect.stringMatching(/marks the work done/),
    ]);

    await api().post(`/api/jobs/${job.id}/start`).set(worker.auth).expect(200);
    await release(owner.auth, job.id, m2.id).expect(200);
    const tooEarly = await release(owner.auth, job.id, m3.id);
    expect(tooEarly.body.code).toBe("TOO_EARLY");

    await api().post(`/api/jobs/${job.id}/mark-done`).set(worker.auth).expect(200);
    await release(owner.auth, job.id, m3.id).expect(200);
    expect((await milestones(job.id)).map((m) => m.status)).toEqual(["released", "released", "released"]);
  });

  it("a release racing a dispute is refused once the dispute lands", async () => {
    for (let round = 0; round < 10; round++) {
      const { owner, worker, job } = await awardedJob({ stage: "in_progress" });
      const [m1] = await milestones(job.id);
      const [rel, disp] = await Promise.all([
        release(owner.auth, job.id, m1.id),
        api().post(`/api/jobs/${job.id}/disputes`).set(worker.auth).field("reason", "Client stopped replying"),
      ]);
      expect(disp.status).toBe(201);
      const [{ status }] = await milestones(job.id);
      // Either the release committed before the dispute, or it was refused as frozen. Never both "released after dispute".
      if (rel.status === 200) expect(status).toBe("released");
      else {
        expect(rel.body.code).toBe("DISPUTED");
        expect(status).toBe("held");
      }
    }
  });

  it("restoring a dispute to 'awaiting confirmation' gives the client a fresh window (no instant auto-release)", async () => {
    const { owner, job } = await awardedJob({ stage: "pending_confirmation" });
    // The pro marked done 5 days ago; the client opened a dispute in time.
    await AppDataSource.query(`UPDATE "jobs" SET "pendingConfirmationAt" = now() - interval '5 days' WHERE "id" = $1`, [job.id]);
    const d = await api().post(`/api/jobs/${job.id}/disputes`).set(owner.auth).field("reason", "Tap still leaks");
    expect(d.status).toBe(201);
    const a = await admin();
    const res = await api().patch(`/api/disputes/${d.body.dispute.id}/resolve`).set(a.auth).send({ resolution: "no_action" });
    expect(res.body.job.status).toBe("pending_confirmation");
    expect(new Date(res.body.job.autoConfirmAt).getTime()).toBeGreaterThan(Date.now() + 2 * 86400_000);

    const run = await runWorkersOnce();
    expect(run.skipped || run.autoConfirmed === 0).toBe(true);
    const [row] = await rows<{ status: string; paymentStatus: string }>(
      `SELECT "status", "paymentStatus" FROM "jobs" WHERE "id" = $1`,
      [job.id]
    );
    expect(row).toEqual({ status: "pending_confirmation", paymentStatus: "held" });
  });
});

describe("bid comparison data", () => {
  it("each bid carries the pro's track record (completed jobs, latest review), never their contact details", async () => {
    const { owner: past, worker } = await awardedJob({ stage: "completed" });
    const [{ id: doneJobId }] = await rows<{ id: string }>(
      `SELECT j."id" FROM "jobs" j JOIN "bids" b ON b."id" = j."acceptedBidId" WHERE b."tradespersonId" = $1`,
      [worker.user.id]
    );
    await api().post("/api/reviews").set(past.auth).send({ jobId: doneJobId, rating: 5, comment: "Fixed it in an hour" }).expect(201);

    const owner = await client();
    const job = await createJob(owner);
    await placeBid(worker, job.id, { amount: 1500 });
    const res = await api().get(`/api/jobs/${job.id}/bids`).set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.body.bids[0].profile).toMatchObject({
      completedJobs: 1,
      averageRating: 5,
      reviewCount: 1,
      galleryPreview: expect.any(Array),
      latestReview: { rating: 5, comment: "Fixed it in an hour" },
    });
    expect(JSON.stringify(res.body)).not.toContain(worker.user.email);
  });
});
