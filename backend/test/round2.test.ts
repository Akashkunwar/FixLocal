import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acceptBid, admin, api, awardedJob, client, createJob, placeBid, pro, rows } from "./helpers";
import { boostedScore } from "../src/utils/matchScore";
import { loadEnv } from "../src/loadEnv";

describe("match scores stay on the 0–100 scale", () => {
  it("clamps a strong pro plus a full availability boost to 100", () => {
    expect(boostedScore(96, 8)).toBe(100);
    expect(boostedScore(40.04, 2.03)).toBe(42.1);
    expect(boostedScore(3, -10)).toBe(0);
    expect(boostedScore(Number.NaN, 5)).toBe(0);
  });
});

describe("tests are isolated from a developer's backend/.env", () => {
  const file = path.join(os.tmpdir(), `fixlocal-env-${process.pid}.env`);
  fs.writeFileSync(file, "DEV_AUTO_VERIFY_EMAIL=true\nAUTO_CONFIRM_DAYS=1\nDB_PASSWORD=from-file\nDB_HOST=db.local\n");

  it("under NODE_ENV=test only DB connection settings are read from .env", () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", DB_HOST: "already-set" };
    loadEnv(file, env);
    expect(env.DEV_AUTO_VERIFY_EMAIL).toBeUndefined();
    expect(env.AUTO_CONFIRM_DAYS).toBeUndefined();
    expect(env.DB_PASSWORD).toBe("from-file");
    expect(env.DB_HOST).toBe("already-set");
  });

  it("outside tests the whole file is loaded (without overriding real env vars)", () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "development", AUTO_CONFIRM_DAYS: "5" };
    loadEnv(file, env);
    expect(env.DEV_AUTO_VERIFY_EMAIL).toBe("true");
    expect(env.AUTO_CONFIRM_DAYS).toBe("5");
  });
});

describe("re-bidding after a withdrawal", () => {
  it("a pro who withdrew can bid again; the old offer stays in the quote history", async () => {
    const owner = await client();
    const worker = await pro();
    const job = await createJob(owner);
    const first = await placeBid(worker, job.id, { amount: 2000, quoteAmount: 2100, quoteNotes: "Old scope" });
    await api().post(`/api/bids/${first.id}/counter-offer`).set(owner.auth).send({ suggestedAmount: 1800 }).expect(200);
    await api().delete(`/api/bids/${first.id}`).set(worker.auth).expect(200);

    const again = await api().post(`/api/jobs/${job.id}/bids`).set(worker.auth).send({ amount: 1700, message: "Can start Monday" });
    expect(again.status).toBe(201);
    expect(again.body.rebid).toBe(true);
    expect(again.body.bid.id).toBe(first.id);
    expect(again.body.bid.status).toBe("active");
    expect(again.body.bid.quoteRevision).toBe(first.quoteRevision + 1);

    const [row] = await rows<{ amount: string; quoteAmount: string | null; quoteNotes: string | null; quoteHistory: Array<{ amount: number; notes: string | null }>; counterOffer: unknown; counterHistory: Array<{ status: string }> }>(
      `SELECT "amount", "quoteAmount", "quoteNotes", "quoteHistory", "counterOffer", "counterHistory" FROM "bids" WHERE "id" = $1`,
      [first.id]
    );
    expect(Number(row.amount)).toBe(1700);
    expect(row.quoteAmount).toBeNull();
    expect(row.quoteNotes).toBeNull();
    expect(row.counterOffer).toBeNull();
    expect(row.quoteHistory.at(-1)).toMatchObject({ amount: 2100, notes: "Old scope" });
    expect(row.counterHistory.at(-1)?.status).toBe("dismissed");

    // The client is told it is a re-bid, and can hire at the new price.
    const notes = await rows<{ title: string }>(`SELECT "title" FROM "notifications" WHERE "userId" = $1 ORDER BY "createdAt" DESC`, [owner.user.id]);
    expect(notes[0].title).toMatch(/bid again/);
    expect((await acceptBid(owner, first.id)).status).toBe(200);
  });

  it("an active bid still can't be duplicated", async () => {
    const owner = await client();
    const worker = await pro();
    const job = await createJob(owner);
    await placeBid(worker, job.id);
    const dup = await api().post(`/api/jobs/${job.id}/bids`).set(worker.auth).send({ amount: 900 });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("DUPLICATE_BID");
  });

  it("re-bidding respects the bid cap", async () => {
    const owner = await client();
    const job = await createJob(owner, { maxBids: 1 });
    const a = await pro();
    const b = await pro();
    const bidA = await placeBid(a, job.id);
    await api().delete(`/api/bids/${bidA.id}`).set(a.auth).expect(200);
    await placeBid(b, job.id);
    const again = await api().post(`/api/jobs/${job.id}/bids`).set(a.auth).send({ amount: 1200 });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("MAX_BIDS");
  });
});

describe("pending review prompts", () => {
  it("lists completed jobs each side still has to review, and drops them once reviewed", async () => {
    const done = await awardedJob({ stage: "completed" });
    await awardedJob({ stage: "in_progress" }); // not completed: never listed

    const mine = await api().get("/api/reviews/pending").set(done.owner.auth).expect(200);
    expect(mine.body.pending).toHaveLength(1);
    expect(mine.body.pending[0]).toMatchObject({
      jobId: done.job.id,
      counterpartId: done.worker.user.id,
      link: `/client/jobs/${done.job.id}#review`,
    });
    const theirs = await api().get("/api/reviews/pending").set(done.worker.auth).expect(200);
    expect(theirs.body.pending.map((p: { jobId: string }) => p.jobId)).toEqual([done.job.id]);
    expect(JSON.stringify(theirs.body)).not.toMatch(/@/); // no emails

    const stranger = await pro();
    expect((await api().get("/api/reviews/pending").set(stranger.auth).expect(200)).body.pending).toEqual([]);
    expect((await api().get("/api/reviews/pending").set((await admin()).auth)).status).toBe(403);

    await api().post("/api/reviews").set(done.owner.auth).send({ jobId: done.job.id, rating: 5 }).expect(201);
    expect((await api().get("/api/reviews/pending").set(done.owner.auth)).body.pending).toEqual([]);
    expect((await api().get("/api/reviews/pending").set(done.worker.auth)).body.pending).toHaveLength(1);
  });
});
