import { describe, expect, it } from "vitest";
import { VerificationStatus } from "../src/entities/TradespersonProfile";
import { acceptBid, admin, api, client, createJob, placeBid, pro, rows } from "./helpers";

describe("placing bids", () => {
  it("requires a verified professional on an open job", async () => {
    const owner = await client();
    const job = await createJob(owner);
    const pending = await pro({ proStatus: VerificationStatus.PENDING });
    const res = await api().post(`/api/jobs/${job.id}/bids`).set(pending.auth).send({ amount: 500 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_VERIFIED");
    expect((await api().post(`/api/jobs/${job.id}/bids`).set(owner.auth).send({ amount: 5 })).status).toBe(403);
  });

  it("validates amounts and dates", async () => {
    const owner = await client();
    const p = await pro();
    const job = await createJob(owner);
    for (const body of [
      { amount: 0 },
      { amount: -5 },
      { amount: 1e9 },
      { amount: "abc" },
      { amount: 10, etaDays: 2.5 },
      { amount: 10, etaDays: 9999 },
      { amount: 10, proposedVisitStart: "2026-12-01T10:00:00Z", proposedVisitEnd: "2026-12-01T09:00:00Z" },
    ]) {
      const res = await api().post(`/api/jobs/${job.id}/bids`).set(p.auth).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("allows only one bid per pro and respects maxBids under concurrency (H-8)", async () => {
    const owner = await client();
    const p1 = await pro();
    const p2 = await pro();
    for (let round = 0; round < 10; round++) {
      const job = await createJob(owner, { maxBids: 1 });
      const results = await Promise.all([
        ...Array.from({ length: 5 }, () => api().post(`/api/jobs/${job.id}/bids`).set(p1.auth).send({ amount: 100 })),
        api().post(`/api/jobs/${job.id}/bids`).set(p2.auth).send({ amount: 90 }),
      ]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
      const [{ n }] = await rows<{ n: string }>(`SELECT COUNT(*) n FROM "bids" WHERE "jobId" = $1`, [job.id]);
      expect(Number(n)).toBe(1);
    }
  });

  it("withdrawn bids can't be withdrawn twice; only the author can withdraw", async () => {
    const owner = await client();
    const p = await pro();
    const other = await pro();
    const job = await createJob(owner);
    const bid = await placeBid(p, job.id);
    expect((await api().delete(`/api/bids/${bid.id}`).set(other.auth)).status).toBe(403);
    expect((await api().delete(`/api/bids/${bid.id}`).set(p.auth)).body.bid.status).toBe("withdrawn");
    expect((await api().delete(`/api/bids/${bid.id}`).set(p.auth)).status).toBe(409);
  });
});

describe("who can see bids (H-1)", () => {
  it("a competing pro sees only their own bid and a count", async () => {
    const owner = await client();
    const p1 = await pro({ name: "Rival One" });
    const p2 = await pro();
    const job = await createJob(owner);
    await placeBid(p1, job.id, { amount: 2500, quoteAmount: 2400, quoteNotes: "my private margin notes" });
    const mine = await placeBid(p2, job.id, { amount: 2000 });

    const res = await api().get(`/api/jobs/${job.id}/bids`).set(p2.auth);
    expect(res.status).toBe(200);
    expect(res.body.bids).toHaveLength(1);
    expect(res.body.bids[0].id).toBe(mine.id);
    expect(res.body.otherActiveBidCount).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain("private margin");
    expect(JSON.stringify(res.body)).not.toContain("Rival One");
  });

  it("a pro without a bid can't list bids", async () => {
    const owner = await client();
    const job = await createJob(owner);
    await placeBid(await pro(), job.id);
    const stranger = await pro();
    expect((await api().get(`/api/jobs/${job.id}/bids`).set(stranger.auth)).status).toBe(403);
    expect((await api().get(`/api/jobs/${job.id}/bids`).set((await client()).auth)).status).toBe(403);
  });

  it("the owner sees full bids but no pro email or exact location", async () => {
    const owner = await client();
    const p = await pro();
    const job = await createJob(owner);
    await placeBid(p, job.id, { amount: 1200, quoteAmount: 1100, quoteNotes: "parts included" });
    const res = await api().get(`/api/jobs/${job.id}/bids`).set(owner.auth);
    const bid = res.body.bids[0];
    expect(bid).toMatchObject({ amount: 1200, quoteAmount: 1100, quoteNotes: "parts included", quoteRevision: 0 });
    expect(bid.tradesperson).toEqual({ id: p.user.id, name: p.user.name });
    expect(bid.profile.lat).toBe(12.98);
    expect(typeof bid.matchScore).toBe("number");
    expect(JSON.stringify(res.body)).not.toContain(p.user.email);
  });
});

describe("accepting bids", () => {
  it("fails with QUOTE_CHANGED if the pro revised the quote after the client looked (C-6)", async () => {
    const owner = await client();
    const p = await pro();
    const job = await createJob(owner);
    const bid = await placeBid(p, job.id, { amount: 1000, quoteAmount: 1000 });
    const seen = (await api().get(`/api/jobs/${job.id}/bids`).set(owner.auth)).body.bids[0];

    await api().patch(`/api/bids/${bid.id}/quote`).set(p.auth).send({ quoteAmount: 9000 }).expect(200);
    const stale = await api()
      .post(`/api/bids/${bid.id}/accept`)
      .set(owner.auth)
      .send({ expectedAmount: seen.quoteAmount, expectedRevision: seen.quoteRevision });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: "QUOTE_CHANGED", currentAmount: 9000, currentRevision: 1 });

    const missing = await api().post(`/api/bids/${bid.id}/accept`).set(owner.auth).send({});
    expect(missing.status).toBe(400);

    const ok = await api()
      .post(`/api/bids/${bid.id}/accept`)
      .set(owner.auth)
      .send({ expectedAmount: 9000, expectedRevision: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body.escrow.amount).toBe(9000);
    expect(ok.body.job).toMatchObject({ status: "awarded", escrowAmount: 9000, paymentStatus: "held" });
  });

  it("concurrent accepts of different bids award exactly one (C-5)", async () => {
    for (let round = 0; round < 20; round++) {
      const owner = await client();
      const p1 = await pro();
      const p2 = await pro();
      const job = await createJob(owner);
      const b1 = await placeBid(p1, job.id, { amount: 1000 });
      const b2 = await placeBid(p2, job.id, { amount: 1100 });
      const [r1, r2] = await Promise.all([acceptBid(owner, b1.id), acceptBid(owner, b2.id)]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      const [counts] = await rows<{ accepted: string; milestones: string; holds: string }>(
        `SELECT (SELECT COUNT(*) FROM bids WHERE "jobId" = $1 AND status = 'accepted') accepted,
                (SELECT COUNT(*) FROM payment_milestones WHERE "jobId" = $1) milestones,
                (SELECT COUNT(*) FROM ledger_entries WHERE "jobId" = $1 AND type = 'hold') holds`,
        [job.id]
      );
      expect(counts).toEqual({ accepted: "1", milestones: "3", holds: "3" });
    }
  });

  it("rejects other bids, notifies both sides, and splits escrow 30/40/30", async () => {
    const owner = await client();
    const winner = await pro();
    const loser = await pro();
    const job = await createJob(owner);
    const b1 = await placeBid(winner, job.id, { amount: 1001 });
    await placeBid(loser, job.id, { amount: 900 });
    const res = await acceptBid(owner, b1.id);
    expect(res.status).toBe(200);
    const statuses = res.body.bids.map((b: { status: string }) => b.status).sort();
    expect(statuses).toEqual(["accepted", "rejected"]);
    const pay = await api().get(`/api/jobs/${job.id}/payments`).set(owner.auth);
    expect(pay.body.milestones.map((m: { amount: number; status: string }) => [m.amount, m.status])).toEqual([
      [300.3, "held"],
      [400.4, "pending"],
      [300.3, "pending"],
    ]);
    expect(pay.body.parties.tradesperson.email).toBe(winner.user.email);
    const n1 = await api().get("/api/notifications").set(winner.auth);
    const n2 = await api().get("/api/notifications").set(loser.auth);
    expect(n1.body.notifications[0].type).toBe("bid_accepted");
    expect(n2.body.notifications[0].type).toBe("bid_rejected");
  });

  it("won't hire a pro who was suspended after bidding", async () => {
    const owner = await client();
    const p = await pro();
    const a = await admin();
    const job = await createJob(owner);
    const bid = await placeBid(p, job.id);
    await api().patch(`/api/admin/users/${p.user.id}/suspend`).set(a.auth).send({ suspended: true }).expect(200);
    const res = await acceptBid(owner, bid.id);
    expect(res.status).toBe(409);
  });

  it("only the job owner can accept", async () => {
    const owner = await client();
    const other = await client();
    const job = await createJob(owner);
    const bid = await placeBid(await pro(), job.id);
    expect((await acceptBid(other, bid.id)).status).toBe(403);
  });

  it("replays the same response for a repeated Idempotency-Key", async () => {
    const owner = await client();
    const job = await createJob(owner);
    const bid = await placeBid(await pro(), job.id, { amount: 700 });
    const send = () =>
      api()
        .post(`/api/bids/${bid.id}/accept`)
        .set(owner.auth)
        .set("Idempotency-Key", "accept-once-123")
        .send({ expectedAmount: 700, expectedRevision: 0 });
    const first = await send();
    const second = await send();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body.job.id).toBe(first.body.job.id);
  });
});

describe("quotes and counter-offers", () => {
  it("tracks revisions, counter-offers, declines and the viewed flag", async () => {
    const owner = await client();
    const p = await pro();
    const job = await createJob(owner);
    const bid = await placeBid(p, job.id, { amount: 1500, quoteAmount: 1500 });

    const counter = await api().post(`/api/bids/${bid.id}/counter-offer`).set(owner.auth).send({ suggestedAmount: 1200, notes: "Tight budget" });
    expect(counter.body.bid.counterOffer).toMatchObject({ suggestedAmount: 1200, status: "pending" });
    expect((await api().post(`/api/bids/${bid.id}/counter-offer`).set(p.auth).send({ suggestedAmount: 1 })).status).toBe(403);

    const decline = await api().post(`/api/bids/${bid.id}/counter-offer/decline`).set(p.auth).send({ notes: "Parts cost more" });
    expect(decline.body.bid.counterOffer.status).toBe("declined");
    expect((await api().post(`/api/bids/${bid.id}/counter-offer/decline`).set(p.auth).send({})).status).toBe(400);

    await api().post(`/api/bids/${bid.id}/counter-offer`).set(owner.auth).send({ suggestedAmount: 1300 }).expect(200);
    const revised = await api().patch(`/api/bids/${bid.id}/quote`).set(p.auth).send({ quoteAmount: 1350, quoteNotes: "Met you halfway" });
    expect(revised.body.bid).toMatchObject({ quoteAmount: 1350, quoteRevision: 1 });
    expect(revised.body.bid.counterOffer.status).toBe("addressed");
    expect(revised.body.quoteDiff.amountDelta).toBe(-150);
    const same = await api().patch(`/api/bids/${bid.id}/quote`).set(p.auth).send({ quoteAmount: 1350, quoteNotes: "Met you halfway" });
    expect(same.body.message).toBe("No quote changes");

    const viewed = await api().post(`/api/bids/${bid.id}/quote-viewed`).set(owner.auth);
    expect(viewed.body).toMatchObject({ viewed: true, notified: true });
    expect((await api().post(`/api/bids/${bid.id}/quote-viewed`).set(owner.auth)).body.notified).toBe(false);

    const analytics = await api().get(`/api/bids/counter-analytics?jobId=${job.id}`).set(owner.auth);
    expect(analytics.body).toMatchObject({ sent: 2, declined: 1, addressed: 1 });
    const proAnalytics = await api().get(`/api/profile/counter-analytics`).set(p.auth);
    expect(proAnalytics.body.sent).toBe(2);
    const other = await client();
    expect((await api().get(`/api/bids/counter-analytics?homeownerId=${owner.user.id}`).set(other.auth)).status).toBe(403);
  });

  it("previews escrow splits only for parties", async () => {
    const owner = await client();
    const p = await pro();
    const job = await createJob(owner);
    const bid = await placeBid(p, job.id, { amount: 1000 });
    const res = await api().get(`/api/bids/${bid.id}/escrow-what-if?amount=2000`).set(owner.auth);
    expect(res.body.milestones.map((m: { amount: number }) => m.amount)).toEqual([600, 800, 600]);
    expect((await api().get(`/api/bids/${bid.id}/escrow-what-if`).set((await pro()).auth)).status).toBe(403);
    expect((await api().get(`/api/bids/${bid.id}/escrow-what-if?amount=-3`).set(owner.auth)).status).toBe(400);
  });
});
