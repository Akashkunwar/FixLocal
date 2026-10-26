import { describe, expect, it } from "vitest";
import { VerificationStatus } from "../src/entities/TradespersonProfile";
import { alertMatchesJob } from "../src/utils/jobAlerts";
import { AppDataSource } from "../src/data-source";
import { consoleMailer } from "../src/services/mailer";
import { sendJobAlertDigests } from "../src/utils/jobAlertDigest";
import { istTimeOn } from "../src/domain/time";
import { acceptBid, admin, api, awardedJob, client, createJob, placeBid, pro, rows } from "./helpers";

const alertsOf = async (userId: string) =>
  rows<{ title: string; body: string; link: string; type: string }>(
    `SELECT "title", "body", "link", "type" FROM "notifications" WHERE "userId" = $1 AND "type" = 'job_alert'`,
    [userId]
  );

describe("job alerts for professionals", () => {
  const base = { categories: [] as string[], city: null, area: null, lat: null, lng: null, radiusKm: null, minBudget: null, siteType: null };
  const job = {
    category: "plumbing",
    city: "Bengaluru",
    area: "Indiranagar",
    address: "12 Lane",
    lat: 12.9789,
    lng: 77.6409,
    budgetMin: 500,
    budgetMax: 2000,
    siteType: "residential",
  } as Parameters<typeof alertMatchesJob>[1];

  it("matches by category, site type, budget, radius and city/area", () => {
    expect(alertMatchesJob(base, job)).toBe(true);
    expect(alertMatchesJob({ ...base, categories: ["electrical"] }, job)).toBe(false);
    expect(alertMatchesJob({ ...base, categories: ["electrical", "plumbing"] }, job)).toBe(true);
    expect(alertMatchesJob({ ...base, siteType: "office" }, job)).toBe(false);
    expect(alertMatchesJob({ ...base, minBudget: 2500 }, job)).toBe(false);
    expect(alertMatchesJob({ ...base, minBudget: 2000 }, job)).toBe(true);
    expect(alertMatchesJob({ ...base, minBudget: 9999 }, { ...job, budgetMin: undefined, budgetMax: undefined })).toBe(true);
    // Koramangala is ~5 km from Indiranagar.
    const kora = { lat: 12.9352, lng: 77.6245 };
    expect(alertMatchesJob({ ...base, ...kora, radiusKm: 3 }, job)).toBe(false);
    expect(alertMatchesJob({ ...base, ...kora, radiusKm: 8 }, job)).toBe(true);
    // No pin on the job: fall back to the text location.
    expect(alertMatchesJob({ ...base, ...kora, radiusKm: 3, city: "bengaluru" }, { ...job, lat: undefined, lng: undefined })).toBe(true);
    expect(alertMatchesJob({ ...base, city: "Mumbai" }, job)).toBe(false);
    expect(alertMatchesJob({ ...base, area: "indiranagar" }, job)).toBe(true);
    expect(alertMatchesJob({ ...base, area: "HSR Layout" }, job)).toBe(false);
  });

  it("a pro saves an alert, sees how many open jobs match, and is notified once per matching new job", async () => {
    const p = await pro();
    const c = await client();
    await createJob(c, { title: "Existing plumbing job" });
    const preview = await api().post("/api/job-alerts/preview").set(p.auth).send({ categories: ["plumbing"], city: "Bengaluru" });
    expect(preview.status).toBe(200);
    expect(preview.body.count).toBeGreaterThanOrEqual(1);
    expect(preview.body.jobs[0]).not.toHaveProperty("address");

    const created = await api()
      .post("/api/job-alerts")
      .set(p.auth)
      .send({ name: "Plumbing near me", frequency: "instant", categories: ["plumbing"], lat: 12.9784, lng: 77.6408, radiusKm: 5 });
    expect(created.status).toBe(201);
    // A second, overlapping alert must not double-notify.
    await api().post("/api/job-alerts").set(p.auth).send({ name: "Anything in Bengaluru", frequency: "instant", city: "Bengaluru" }).expect(201);

    const j = await createJob(c, { title: "Bathroom tap leaking" });
    await createJob(c, { title: "Rewire the hall", category: "electrical", lat: 12.9784, lng: 77.6408 });
    const got = await alertsOf(p.user.id);
    expect(got.filter((n) => n.title.includes("Bathroom tap leaking"))).toHaveLength(1);
    expect(got[0].link).toBe(`/professional/jobs/${j.id}`);
    expect(got.some((n) => n.title.includes("Rewire"))).toBe(true); // matched the city-wide alert

    const list = await api().get("/api/job-alerts").set(p.auth);
    const near = list.body.alerts.find((a: { name: string }) => a.name === "Plumbing near me");
    expect(near.matchCount).toBe(1);

    // Paused alerts stay quiet.
    for (const a of list.body.alerts) await api().patch(`/api/job-alerts/${a.id}`).set(p.auth).send({ active: false }).expect(200);
    await createJob(c, { title: "Another tap" });
    expect((await alertsOf(p.user.id)).some((n) => n.title.includes("Another tap"))).toBe(false);
  });

  it("skips unverified pros, blocked pairs and the client's own account; alerts are private to their owner", async () => {
    const c = await client();
    const pending = await pro({ proStatus: VerificationStatus.PENDING });
    const blocked = await pro();
    const other = await pro();
    for (const p of [pending, blocked]) {
      await api().post("/api/job-alerts").set(p.auth).send({ name: "All", frequency: "instant", city: "Bengaluru" }).expect(201);
    }
    await api().post("/api/blocks").set(c.auth).send({ userId: blocked.user.id }).expect(201);
    await createJob(c, { title: "Silent job" });
    expect(await alertsOf(pending.user.id)).toHaveLength(0);
    expect(await alertsOf(blocked.user.id)).toHaveLength(0);

    const mine = (await api().get("/api/job-alerts").set(blocked.auth)).body.alerts[0];
    expect((await api().patch(`/api/job-alerts/${mine.id}`).set(other.auth).send({ active: false })).status).toBe(404);
    expect((await api().delete(`/api/job-alerts/${mine.id}`).set(other.auth)).status).toBe(404);
    expect((await api().get("/api/job-alerts").set(c.auth)).status).toBe(403);
    expect((await api().delete(`/api/job-alerts/${mine.id}`).set(blocked.auth)).status).toBe(200);
  });

  it("daily alerts wait for one 8 AM IST digest that is never sent twice", async () => {
    const p = await pro();
    const instant = await pro();
    const c = await client();
    const created = await api().post("/api/job-alerts").set(p.auth).send({ name: "Daily Bengaluru", city: "Bengaluru" });
    expect(created.body.alert.frequency).toBe("daily");
    await api().post("/api/job-alerts").set(instant.auth).send({ name: "Now", frequency: "instant", city: "Bengaluru" }).expect(201);
    await createJob(c, { title: "Digest job one" });
    await createJob(c, { title: "Digest job two" });
    expect(await alertsOf(p.user.id)).toHaveLength(0);
    expect(await alertsOf(instant.user.id)).toHaveLength(2);

    const at8 = new Date(istTimeOn(new Date(), 8).getTime() + 5 * 60_000);
    expect(await sendJobAlertDigests(new Date(at8.getTime() - 3600_000))).toBe(0); // 7:05 IST: too early
    const runs = await Promise.all([sendJobAlertDigests(at8), sendJobAlertDigests(at8), sendJobAlertDigests(new Date(at8.getTime() + 3600_000))]);
    expect(runs.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1);
    const digest = await alertsOf(p.user.id);
    expect(digest).toHaveLength(1);
    expect(digest[0].title).toBe("New jobs match your alerts");
    expect(digest[0].body).toMatch(/^2 jobs from the last 24 hours/);
    const mails = consoleMailer.outbox.filter((m) => m.to === p.user.email && m.subject.includes("matched your alerts"));
    expect(mails).toHaveLength(1);
    expect(mails[0].text).toContain("Digest job one");
    expect(mails[0].text).toContain("Digest job two");
    expect(await sendJobAlertDigests(new Date(at8.getTime() + 2 * 3600_000))).toBe(0);

    // Next IST day, in Hindi: only the new job, and the email is in Hindi.
    await api().patch("/api/auth/me").set(p.auth).send({ language: "hi" }).expect(200);
    const j3 = await createJob(c, { title: "Digest job three" });
    const day2 = new Date(at8.getTime() + 24 * 3600_000);
    await AppDataSource.query(`UPDATE "job_alert_matches" SET "createdAt" = $1 WHERE "jobId" = $2`, [new Date(day2.getTime() - 3600_000), j3.id]);
    expect(await sendJobAlertDigests(day2)).toBe(1);
    const hi = consoleMailer.outbox.find((m) => m.to === p.user.email && m.text.includes("Digest job three"));
    expect(hi?.subject).toContain("नए काम");
    expect(hi?.text).not.toContain("Digest job one");
  });

  it("validates input and caps alerts per pro", async () => {
    const p = await pro();
    expect((await api().post("/api/job-alerts").set(p.auth).send({ name: "x", radiusKm: 5 })).status).toBe(400);
    expect((await api().post("/api/job-alerts").set(p.auth).send({ name: "x", categories: ["rockets"] })).status).toBe(400);
    expect((await api().post("/api/job-alerts").set(p.auth).send({ name: "" })).status).toBe(400);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => api().post("/api/job-alerts").set(p.auth).send({ name: `Alert ${i}` }))
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(results.filter((r) => r.status === 409)[0].body.code).toBe("ALERT_LIMIT");
  });
});

describe("notification centre", () => {
  it("filters by type and pages with `before`", async () => {
    const owner = await client();
    const bidders = await Promise.all([pro(), pro(), pro()]);
    const job = await createJob(owner);
    for (const b of bidders) {
      await api().post(`/api/jobs/${job.id}/bids`).set(b.auth).send({ amount: 1200 }).expect(201);
      await new Promise((r) => setTimeout(r, 5));
    }
    await api().post(`/api/messages/${job.id}`).set(bidders[0].auth).send({ body: "Hello, when can I visit?" }).expect(201);
    const bids = await api().get("/api/notifications?types=new_bid&limit=2").set(owner.auth);
    expect(bids.status).toBe(200);
    expect(bids.body.notifications).toHaveLength(2);
    expect(bids.body.total).toBe(3);
    expect(bids.body.notifications.every((n: { type: string }) => n.type === "new_bid")).toBe(true);
    const older = await api()
      .get(`/api/notifications?types=new_bid&limit=2&before=${encodeURIComponent(bids.body.notifications[1].createdAt)}`)
      .set(owner.auth);
    expect(older.body.notifications).toHaveLength(1);
    const msgs = await api().get("/api/notifications?types=message,new_bid").set(owner.auth);
    expect(msgs.body.notifications.some((n: { type: string }) => n.type === "message")).toBe(true);
    expect((await api().get("/api/notifications?types=nope").set(owner.auth)).status).toBe(400);
  });
});

describe("client spending and job history", () => {
  it("adds up paid, held and refunded escrow per job, month, category and pro; private to the client", async () => {
    const done = await awardedJob({ stage: "completed", amount: 1000 });
    const owner = done.owner;
    // A second job with the same pro, still in escrow.
    const j2 = await createJob(owner, { title: "Fix bathroom tap", category: "plumbing" });
    const b2 = await placeBid(done.worker, j2.id, { amount: 600 });
    expect((await acceptBid(owner, b2.id)).status).toBe(200);
    // A third, cancelled before work with a refund.
    const other = await pro({ name: "Second Pro" });
    const j3 = await createJob(owner, { title: "Paint a wall", category: "painting" });
    const b3 = await placeBid(other, j3.id, { amount: 400 });
    expect((await acceptBid(owner, b3.id)).status).toBe(200);
    await api().post(`/api/jobs/${j3.id}/cancel-booking`).set(owner.auth).send({ reason: "Plans changed" }).expect(200);
    await createJob(owner, { title: "Still open" });

    const res = await api().get("/api/jobs/spending").set(owner.auth);
    expect(res.status).toBe(200);
    const s = res.body.spending;
    expect(s.totals).toMatchObject({ paid: 1000, inEscrow: 600, jobsPosted: 4, jobsCompleted: 1, jobsActive: 1, jobsOpen: 1, jobsCancelled: 1 });
    expect(s.totals.refunded).toBeGreaterThan(0);
    expect(s.months).toHaveLength(12);
    expect(s.months[11].amount).toBe(1000);
    expect(s.byCategory).toEqual([{ category: "plumbing", jobs: 1, paid: 1000 }]);
    expect(s.topPros[0]).toMatchObject({ proId: done.worker.user.id, jobs: 1, paid: 1000 });
    const row = s.jobs.find((j: { jobId: string }) => j.jobId === j2.id);
    expect(row).toMatchObject({ paid: 0, inEscrow: 600, pro: { id: done.worker.user.id } });
    expect(row).not.toHaveProperty("address");

    expect((await api().get("/api/jobs/spending").set(done.worker.auth)).status).toBe(403);
    const stranger = await client();
    const empty = (await api().get("/api/jobs/spending").set(stranger.auth)).body.spending;
    expect(empty.totals).toMatchObject({ paid: 0, inEscrow: 0, jobsPosted: 0 });
  });
});

describe("referrals", () => {
  const signUp = (email: string, referralCode?: string) =>
    api()
      .post("/api/auth/register")
      .send({ email, password: "Long-Password-123", role: "HOMEOWNER", name: "Asha Verma", acceptTerms: true, referralCode });

  it("gives each user one stable code and credits sign-ups that use it, without revealing anything", async () => {
    const inviter = await pro();
    const before = await api().get("/api/referrals/me").set(inviter.auth);
    expect(before.body.referral.code).toBeNull();
    const [a, b] = await Promise.all([
      api().post("/api/referrals/me/code").set(inviter.auth),
      api().post("/api/referrals/me/code").set(inviter.auth),
    ]);
    expect(a.body.referral.code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(b.body.referral.code).toBe(a.body.referral.code);
    const code: string = a.body.referral.code;
    expect(a.body.referral.link).toMatch(new RegExp(`/register\\?ref=${code}$`));

    const good = await signUp(`ref-${Date.now()}@example.com`, code.toLowerCase());
    const bad = await signUp(`ref2-${Date.now()}@example.com`, "NOSUCHCODE");
    expect(good.status).toBe(202);
    expect(bad.status).toBe(202);
    expect(bad.body).toEqual(good.body);
    expect((await signUp(`ref3-${Date.now()}@example.com`, "bad code!")).status).toBe(400);

    const mine = (await api().get("/api/referrals/me").set(inviter.auth)).body.referral;
    expect(mine.totals).toEqual({ joined: 1, confirmed: 0, completedFirstJob: 0 });
    expect(mine.people).toEqual([{ firstName: "Asha", joinedAt: expect.any(String), status: "joined", reward: null, rewardAmount: 0 }]);
    expect(JSON.stringify(mine)).not.toMatch(/@example\.com/);
    expect((await api().get("/api/referrals/me").set((await admin()).auth)).status).toBe(403);
  });

  it("counts a referred client's first completed job", async () => {
    const inviter = await client();
    const { body } = await api().post("/api/referrals/me/code").set(inviter.auth);
    const done = await awardedJob({ stage: "completed" });
    await AppDataSource.query(`UPDATE "users" SET "referredById" = $1 WHERE "id" = $2`, [inviter.user.id, done.owner.user.id]);
    const mine = (await api().get("/api/referrals/me").set(inviter.auth)).body.referral;
    expect(body.referral.code).toBeTruthy();
    expect(mine.totals).toEqual({ joined: 1, confirmed: 1, completedFirstJob: 1 });
    expect(mine.people[0].status).toBe("completed_first_job");
  });
});
