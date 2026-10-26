import { afterEach, describe, expect, it } from "vitest";
import { AppDataSource } from "../src/data-source";
import { config, overrideConfig } from "../src/config";
import { canonicalEmail, selfReferralReason } from "../src/domain/credits";
import { PASSWORD, acceptBid, admin, api, awardedJob, client, createJob, placeBid, pro, rows, type TestUser } from "./helpers";

const balance = async (u: TestUser) => (await api().get("/api/credits/me").set(u.auth)).body.credits.balance as number;
// Test users share one phone number, which the self-referral check would (rightly) catch.
const refer = (referred: TestUser, referrer: TestUser) =>
  AppDataSource.query(`UPDATE "users" SET "referredById" = $1, "phone" = NULL WHERE "id" = $2`, [referrer.user.id, referred.user.id]);
const confirm = (job: { id: string }, owner: TestUser) => api().post(`/api/jobs/${job.id}/confirm`).set(owner.auth);

describe("referral credit", () => {
  const original = { ...config().referral };
  afterEach(() => overrideConfig({ referral: { ...original } }));

  it("spots self-referrals by account, job partner, email, phone and device", () => {
    const base = { id: "b", email: "asha.v+fix@gmail.com", phone: "+91 98450 12345", deletedAt: null, isSuspended: false, referredById: "a", signupDeviceHash: "d2" };
    const ref = { id: "a", email: "other@example.com", phone: null, deletedAt: null, isSuspended: false, referredById: null, signupDeviceHash: "d1" };
    expect(canonicalEmail("A.Sha.V+x@GoogleMail.com")).toBe("ashav@gmail.com");
    expect(selfReferralReason(base, ref, "z")).toBeNull();
    expect(selfReferralReason(base, null, "z")).toBe("referrer_inactive");
    expect(selfReferralReason(base, { ...ref, isSuspended: true }, "z")).toBe("referrer_inactive");
    expect(selfReferralReason(base, ref, "a")).toBe("self_dealing");
    expect(selfReferralReason(base, { ...ref, email: "ashav@gmail.com" }, "z")).toBe("same_email");
    expect(selfReferralReason(base, { ...ref, phone: "9845012345" }, "z")).toBe("same_phone");
    expect(selfReferralReason(base, { ...ref, signupDeviceHash: "d2" }, "z")).toBe("same_device");
    expect(selfReferralReason({ ...base, signupDeviceHash: null }, { ...ref, signupDeviceHash: null }, "z")).toBeNull();
  });

  it("pays both sides once when the referred client's first job is confirmed, then uses it at the next hire", async () => {
    const inviter = await pro();
    const { owner, worker, job } = await awardedJob({ stage: "pending_confirmation", amount: 1200 });
    await refer(owner, inviter);
    expect((await confirm(job, owner)).status).toBe(200);
    expect(await balance(owner)).toBe(100);
    expect(await balance(inviter)).toBe(100);
    const notes = await rows<{ title: string }>(`SELECT "title" FROM "notifications" WHERE "userId" = $1 AND "title" = 'You earned FixLocal credit'`, [inviter.user.id]);
    expect(notes).toHaveLength(1);
    expect(await rows(`SELECT 1 FROM "audit_logs" WHERE "action" = 'referral_reward' AND "targetId" = $1`, [job.id])).toHaveLength(1);

    // Second hire: the client's ₹100 comes off what they fund; the payment panel says so.
    const job2 = await createJob(owner);
    const bid2 = await placeBid(worker, job2.id, { amount: 1500 });
    expect((await acceptBid(owner, bid2.id)).status).toBe(200);
    const pay = await api().get(`/api/jobs/${job2.id}/payments`).set(owner.auth);
    expect(pay.body.credit).toEqual({ appliedToPayment: 100, addedToPayout: 0 });
    expect(await balance(owner)).toBe(0);
    // ...and finishing it pays no second reward.
    await api().post(`/api/jobs/${job2.id}/start`).set(worker.auth).expect(200);
    await api().post(`/api/jobs/${job2.id}/mark-done`).set(worker.auth).expect(200);
    await confirm(job2, owner).expect(200);
    expect(await balance(inviter)).toBe(100);
    expect(await rows(`SELECT 1 FROM "referral_rewards" WHERE "referredId" = $1`, [owner.user.id])).toHaveLength(1);

    const credits = (await api().get("/api/credits/me").set(owner.auth)).body.credits;
    expect(credits.entries.map((e: { kind: string; amount: number }) => [e.kind, e.amount])).toEqual([
      ["applied_payment", -100],
      ["referral_reward", 100],
    ]);
    expect((await api().get("/api/credits/me").set((await admin()).auth)).status).toBe(403);
  });

  it("adds a referred professional's credit to their next payout", async () => {
    const inviter = await client();
    const first = await awardedJob({ stage: "pending_confirmation", amount: 800 });
    await refer(first.worker, inviter);
    await confirm(first.job, first.owner).expect(200);
    expect(await balance(first.worker)).toBe(100);
    const c2 = await client();
    const job = await createJob(c2);
    const bid = await placeBid(first.worker, job.id, { amount: 2000 });
    await acceptBid(c2, bid.id);
    const ms = (await api().get(`/api/jobs/${job.id}/payments`).set(c2.auth)).body.milestones;
    const rel = await api().post(`/api/jobs/${job.id}/payments/${ms[0].id}/release`).set(c2.auth);
    expect(rel.status).toBe(200);
    expect(await balance(first.worker)).toBe(0);
    const panel = await api().get(`/api/jobs/${job.id}/payments`).set(first.worker.auth);
    expect(panel.body.credit.addedToPayout).toBe(100);
    const note = await rows<{ body: string }>(`SELECT "body" FROM "notifications" WHERE "userId" = $1 AND "title" = 'Payment released'`, [first.worker.user.id]);
    expect(note[0].body).toContain("₹100 FixLocal credit was added");
  });

  it("blocks self-dealing and small jobs, caps rewards per month and reverses a reward when the dispute is lost", async () => {
    // The inviter hires the person they invited: no reward, but the decision is recorded.
    const sd = await awardedJob({ stage: "pending_confirmation", amount: 1000 });
    await refer(sd.worker, sd.owner);
    await confirm(sd.job, sd.owner).expect(200);
    expect(await balance(sd.worker)).toBe(0);
    expect((await rows<{ status: string; reason: string }>(`SELECT "status", "reason" FROM "referral_rewards" WHERE "referredId" = $1`, [sd.worker.user.id]))[0]).toEqual({ status: "blocked", reason: "self_dealing" });
    expect(await rows(`SELECT 1 FROM "audit_logs" WHERE "action" = 'referral_blocked' AND "targetId" = $1`, [sd.job.id])).toHaveLength(1);

    // Below the minimum job value: nothing yet (a later, bigger job can still qualify).
    const small = await awardedJob({ stage: "pending_confirmation", amount: 300 });
    const inviter = await pro();
    await refer(small.owner, inviter);
    await confirm(small.job, small.owner).expect(200);
    expect(await balance(small.owner)).toBe(0);
    expect(await rows(`SELECT 1 FROM "referral_rewards" WHERE "referredId" = $1`, [small.owner.user.id])).toHaveLength(0);

    // Monthly cap of 1: the second friend still gets theirs, the inviter doesn't.
    overrideConfig({ referral: { ...original, monthlyCap: 1 } });
    const capper = await pro();
    const a = await awardedJob({ stage: "pending_confirmation" });
    const b = await awardedJob({ stage: "pending_confirmation" });
    await refer(a.owner, capper);
    await refer(b.owner, capper);
    await confirm(a.job, a.owner).expect(200);
    await confirm(b.job, b.owner).expect(200);
    expect(await balance(capper)).toBe(100);
    expect(await balance(b.owner)).toBe(100);
    const capped = await api().get("/api/referrals/me").set(capper.auth);
    expect(capped.body.referral.earned).toBe(100);
    expect(capped.body.referral.people.map((p: { rewardAmount: number }) => p.rewardAmount).sort()).toEqual([0, 100]);

    // Dispute on the completed job, decided for the professional's opponent: unused credit goes back.
    const d = await api().post(`/api/jobs/${a.job.id}/disputes`).set(a.owner.auth).field("reason", "Tap still leaks after a day");
    expect(d.status).toBe(201);
    const res = await api().patch(`/api/disputes/${d.body.dispute.id}/resolve`).set((await admin()).auth).send({ resolution: "favor_homeowner" });
    expect(res.status).toBe(200);
    expect(await balance(a.owner)).toBe(0);
    expect(await balance(capper)).toBe(0);
    expect((await rows<{ status: string }>(`SELECT "status" FROM "referral_rewards" WHERE "referredId" = $1`, [a.owner.user.id]))[0].status).toBe("reversed");
    expect(await rows(`SELECT 1 FROM "audit_logs" WHERE "action" = 'referral_reversed' AND "targetId" = $1`, [a.job.id])).toHaveLength(1);
  });

  it("is in the data export and goes with a deleted account", async () => {
    const inviter = await pro();
    const { owner, job } = await awardedJob({ stage: "pending_confirmation" });
    await refer(owner, inviter);
    await confirm(job, owner).expect(200);
    const exp = await api().get("/api/auth/me/export").set(owner.auth);
    expect(exp.body.credits.entries).toHaveLength(1);
    expect(exp.body.referralRewards[0]).toMatchObject({ role: "you_were_invited", status: "granted" });
    expect(JSON.stringify(exp.body)).not.toContain("signupDeviceHash");
    await api().delete("/api/auth/me").set(owner.auth).send({ password: PASSWORD }).expect(200);
    expect(await rows(`SELECT 1 FROM "credit_entries" WHERE "userId" = $1`, [owner.user.id])).toHaveLength(0);
  });

  it("records a sign-up device hash that matches only for the same browser", async () => {
    const reg = (email: string, ua: string) =>
      api().post("/api/auth/register").set("User-Agent", ua).send({ email, password: "Long-Password-123", role: "HOMEOWNER", acceptTerms: true });
    const t = Date.now();
    await reg(`dev-a-${t}@example.com`, "Phone A").expect(202);
    await reg(`dev-b-${t}@example.com`, "Phone A").expect(202);
    await reg(`dev-c-${t}@example.com`, "Laptop C").expect(202);
    const h = await rows<{ email: string; signupDeviceHash: string }>(
      `SELECT "email", "signupDeviceHash" FROM "users" WHERE "email" LIKE $1 ORDER BY "email"`,
      [`dev-%-${t}@example.com`]
    );
    expect(h[0].signupDeviceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(h[0].signupDeviceHash).toBe(h[1].signupDeviceHash);
    expect(h[2].signupDeviceHash).not.toBe(h[0].signupDeviceHash);
  });

  it("can be switched off with REFERRAL_REWARD_INR=0", async () => {
    overrideConfig({ referral: { ...original, rewardInr: 0 } });
    const inviter = await pro();
    const { owner, job } = await awardedJob({ stage: "pending_confirmation" });
    await refer(owner, inviter);
    await confirm(job, owner).expect(200);
    expect(await balance(owner)).toBe(0);
  });
});
