import { describe, expect, it } from "vitest";
import { AppDataSource } from "../src/data-source";
import { flushTestCache } from "../src/utils/cache";
import { gstinCheckChar, isValidGstin } from "../src/domain/gstin";
import { containsContactInfo } from "../src/domain/contactInfo";
import { expireOpenJobs, warnExpiringJobs } from "../src/workers/jobExpiry";
import { acceptBid, admin, api, awardedJob, client, createJob, placeBid, pro, rows } from "./helpers";

const DAY = 86400_000;
const titles = async (userId: string) =>
  (await rows<{ title: string }>(`SELECT "title" FROM "notifications" WHERE "userId" = $1 ORDER BY "createdAt"`, [userId])).map((r) => r.title);

describe("review replies", () => {
  it("lets only the reviewed person reply, shows the reply publicly, and notifies the reviewer once", async () => {
    const { owner, worker, job } = await awardedJob({ stage: "completed" });
    const review = (await api().post("/api/reviews").set(owner.auth).send({ jobId: job.id, rating: 3, comment: "Late by an hour" }).expect(201)).body.review;
    expect(review.reply).toBeNull();

    expect((await api().put(`/api/reviews/${review.id}/reply`).set(owner.auth).send({ reply: "me" })).status).toBe(403);
    expect((await api().put(`/api/reviews/${review.id}/reply`).set((await pro()).auth).send({ reply: "x" })).status).toBe(403);
    expect((await api().put(`/api/reviews/${crypto.randomUUID()}/reply`).set(worker.auth).send({ reply: "x" })).status).toBe(404);
    expect((await api().put(`/api/reviews/${review.id}/reply`).set(worker.auth).send({ reply: "x".repeat(1001) })).status).toBe(400);

    const r1 = await api().put(`/api/reviews/${review.id}/reply`).set(worker.auth).send({ reply: "Sorry, traffic on ORR. Fixed the tap free." }).expect(200);
    expect(r1.body.review).toMatchObject({ reply: "Sorry, traffic on ORR. Fixed the tap free." });
    expect(r1.body.review.repliedAt).toBeTruthy();
    await api().put(`/api/reviews/${review.id}/reply`).set(worker.auth).send({ reply: "Edited reply" }).expect(200);

    const pub = await api().get(`/api/profile/user/${worker.user.id}`).set((await client()).auth);
    expect(pub.body.reviews[0]).toMatchObject({ comment: "Late by an hour", reply: "Edited reply" });
    expect((await titles(owner.user.id)).filter((t) => t === "Reply to your review")).toHaveLength(1);

    const cleared = await api().put(`/api/reviews/${review.id}/reply`).set(worker.auth).send({ reply: "  " }).expect(200);
    expect(cleared.body.review).toMatchObject({ reply: null, repliedAt: null });
  });
});

describe("urgent jobs", () => {
  it("flags urgent jobs for 48 hours, filters them, and lets the client turn it off", async () => {
    const owner = await client();
    const viewerPro = await pro();
    const urgent = await createJob(owner, { urgent: true, title: "Burst pipe flooding kitchen" });
    const normal = await createJob(owner, { title: "Paint the balcony railings" });
    expect(urgent.urgent).toBe(true);
    expect(normal.urgent).toBe(false);

    const list = await api().get("/api/jobs?urgent=true&limit=50").set(viewerPro.auth).expect(200);
    const ids = list.body.jobs.map((j: { id: string }) => j.id);
    expect(ids).toContain(urgent.id);
    expect(ids).not.toContain(normal.id);

    // After two days it is an ordinary job again.
    await AppDataSource.query(`UPDATE "jobs" SET "createdAt" = now() - interval '49 hours' WHERE "id" = $1`, [urgent.id]);
    await flushTestCache();
    const later = await api().get(`/api/jobs/${urgent.id}`).set(viewerPro.auth).expect(200);
    expect(later.body.job.urgent).toBe(false);
    const list2 = await api().get("/api/jobs?urgent=true&limit=50").set((await pro()).auth).expect(200);
    expect(list2.body.jobs.map((j: { id: string }) => j.id)).not.toContain(urgent.id);

    const fresh = await createJob(owner, { urgent: true });
    const patched = await api().patch(`/api/jobs/${fresh.id}`).set(owner.auth).send({ urgent: false }).expect(200);
    expect(patched.body.job.urgent).toBe(false);
  });

  it("sends urgent jobs to daily-digest subscribers straight away", async () => {
    const owner = await client();
    const watcher = await pro();
    await api().post("/api/job-alerts").set(watcher.auth).send({ name: "Plumbing", categories: ["plumbing"], frequency: "daily" }).expect(201);
    await createJob(owner, { urgent: true, category: "plumbing" });
    const note = await rows<{ body: string }>(`SELECT "body" FROM "notifications" WHERE "userId" = $1 AND "type" = 'job_alert'`, [watcher.user.id]);
    expect(note).toHaveLength(1);
    expect(note[0].body).toMatch(/^Urgent: needed within 24 hours\./);
  });
});

describe("questions before bidding", () => {
  it("lets verified pros ask, the client answer, and other pros read without seeing who asked", async () => {
    const owner = await client();
    const asker = await pro({ name: "Ravi Plumber" });
    const reader = await pro();
    const job = await createJob(owner);
    const q = await api().post(`/api/jobs/${job.id}/questions`).set(asker.auth).send({ question: "Is the leak under the sink or in the wall?" });
    expect(q.status).toBe(201);
    expect(q.body.question).toMatchObject({ askedByYou: true, askerName: null, answer: null });

    // The client sees who asked; other pros don't.
    const ownerView = await api().get(`/api/jobs/${job.id}/questions`).set(owner.auth).expect(200);
    expect(ownerView.body).toMatchObject({ canAnswer: true, canAsk: false });
    expect(ownerView.body.questions[0]).toMatchObject({ askerName: "Ravi Plumber", askedByYou: false });
    const readerView = await api().get(`/api/jobs/${job.id}/questions`).set(reader.auth).expect(200);
    expect(readerView.body).toMatchObject({ canAnswer: false, canAsk: true });
    expect(JSON.stringify(readerView.body)).not.toContain("Ravi");
    expect(JSON.stringify(readerView.body)).not.toContain(asker.user.id);
    expect(await titles(owner.user.id)).toContain("New question on your job");

    // Only the owner answers; the asker is told once.
    const qid = q.body.question.id;
    expect((await api().put(`/api/jobs/${job.id}/questions/${qid}/answer`).set(reader.auth).send({ answer: "x" })).status).toBe(403);
    await api().put(`/api/jobs/${job.id}/questions/${qid}/answer`).set(owner.auth).send({ answer: "Inside the wall behind the sink." }).expect(200);
    await api().put(`/api/jobs/${job.id}/questions/${qid}/answer`).set(owner.auth).send({ answer: "Inside the wall, about 1 ft up." }).expect(200);
    expect((await titles(asker.user.id)).filter((t) => t === "Your question was answered")).toHaveLength(1);
    const after = await api().get(`/api/jobs/${job.id}/questions`).set(reader.auth).expect(200);
    expect(after.body.questions[0].answer).toBe("Inside the wall, about 1 ft up.");

    // Other pros can't delete it; the asker can.
    expect((await api().delete(`/api/jobs/${job.id}/questions/${qid}`).set(reader.auth)).status).toBe(403);
    await api().delete(`/api/jobs/${job.id}/questions/${qid}`).set(asker.auth).expect(200);
    expect((await api().get(`/api/jobs/${job.id}/questions`).set(owner.auth)).body.questions).toHaveLength(0);
  });

  it("blocks contact details, unverified pros, strangers, too many open questions, and closed jobs", async () => {
    const owner = await client();
    const asker = await pro();
    const job = await createJob(owner);
    const ask = (u: { auth: Record<string, string> }, question: string) => api().post(`/api/jobs/${job.id}/questions`).set(u.auth).send({ question });

    const phone = await ask(asker, "Call me on 98450 12345 to discuss");
    expect(phone.status).toBe(400);
    expect(phone.body.code).toBe("CONTACT_INFO");
    expect((await ask(asker, "Mail ravi.fix@gmail.com")).status).toBe(400);
    expect((await ask(await pro({ proStatus: "pending" as never }), "Any parking?")).status).toBe(403);
    expect((await ask(await client(), "Any parking?")).status).toBe(403);
    expect((await api().get(`/api/jobs/${job.id}/questions`).set((await client()).auth)).status).toBe(403);

    for (const n of [1, 2, 3]) expect((await ask(asker, `Question ${n}?`)).status).toBe(201);
    const fourth = await ask(asker, "Question 4?");
    expect(fourth.status).toBe(409);
    expect(fourth.body.code).toBe("TOO_MANY_QUESTIONS");

    const qs = (await api().get(`/api/jobs/${job.id}/questions`).set(owner.auth)).body.questions;
    const answer = await api().put(`/api/jobs/${job.id}/questions/${qs[0].id}/answer`).set(owner.auth).send({ answer: "My number is 9845012345" });
    expect(answer.body.code).toBe("CONTACT_INFO");

    // Once someone is hired, questions close (but stay readable to the parties).
    const bid = await placeBid(asker, job.id, { amount: 1500 });
    await acceptBid(owner, bid.id);
    expect((await ask(asker, "Still there?")).status).toBe(409);
    expect((await api().get(`/api/jobs/${job.id}/questions`).set(asker.auth)).body.questions).toHaveLength(3);
    expect((await api().get(`/api/jobs/${job.id}/questions`).set((await admin()).auth)).status).toBe(200);
  });

  it("spots phone numbers and emails but not prices or sizes", () => {
    for (const s of ["+91 98450 12345", "098450-12345", "call 9845012345", "a.b@c.in"]) expect(containsContactInfo(s), s).toBe(true);
    for (const s of ["Budget ₹15,000", "2 BHK, 1200 sq ft", "between 10 and 12 tomorrow", "3 taps 2 pipes"]) expect(containsContactInfo(s), s).toBe(false);
  });
});

describe("GST details", () => {
  it("validates GSTINs with the check character", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isValidGstin("29aagcb7383j1z4".toUpperCase())).toBe(true);
    expect(isValidGstin("27AAPFU0939F1ZX")).toBe(false);
    expect(isValidGstin("27AAPFU0939F1Z")).toBe(false);
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
  });

  it("saves business details on the account and prints them on both parties' payment summary", async () => {
    const { owner, worker, job } = await awardedJob();
    const bad = await api().patch("/api/auth/me").set(owner.auth).send({ gstin: "27AAPFU0939F1ZX" });
    expect(bad.status).toBe(400);
    const ok = await api().patch("/api/auth/me").set(owner.auth).send({ businessName: "Acme Interiors LLP", gstin: " 27aapfu0939f1zv " }).expect(200);
    expect(ok.body.user).toMatchObject({ businessName: "Acme Interiors LLP", gstin: "27AAPFU0939F1ZV" });
    await api().patch("/api/auth/me").set(worker.auth).send({ gstin: "29AAGCB7383J1Z4" }).expect(200);

    const pay = await api().get(`/api/jobs/${job.id}/payments`).set(worker.auth).expect(200);
    expect(pay.body.parties.homeowner).toMatchObject({ businessName: "Acme Interiors LLP", gstin: "27AAPFU0939F1ZV" });
    expect(pay.body.parties.tradesperson).toMatchObject({ gstin: "29AAGCB7383J1Z4", businessName: null });

    const cleared = await api().patch("/api/auth/me").set(owner.auth).send({ gstin: "", businessName: "" }).expect(200);
    expect(cleared.body.user).toMatchObject({ businessName: null, gstin: null });
  });
});

describe("open jobs close when nobody is hired", () => {
  it("warns three days ahead once, lets the client keep it open, then closes it and tells bidders", async () => {
    const owner = await client();
    const bidder = await pro();
    const job = await createJob(owner);
    expect(new Date(job.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    await placeBid(bidder, job.id, { amount: 1500 });
    const hired = await awardedJob(); // already hired: never touched

    const t0 = new Date(Date.now() + 28 * DAY);
    expect(await warnExpiringJobs(t0)).toBeGreaterThanOrEqual(1);
    expect(await warnExpiringJobs(t0)).toBe(0);
    expect((await titles(owner.user.id)).filter((t) => t === "Your job closes soon")).toHaveLength(1);

    const kept = await api().post(`/api/jobs/${job.id}/keep-open`).set(owner.auth).expect(200);
    expect(new Date(kept.body.job.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    expect((await api().post(`/api/jobs/${job.id}/keep-open`).set(bidder.auth)).status).toBe(403);
    // A fresh window: the reminder is re-armed for the new date.
    expect((await rows(`SELECT "expiryWarnedAt" FROM "jobs" WHERE "id" = $1`, [job.id]))[0]).toMatchObject({ expiryWarnedAt: null });

    const t1 = new Date(Date.now() + 31 * DAY);
    expect(await expireOpenJobs(t1)).toBeGreaterThanOrEqual(1);
    expect(await expireOpenJobs(t1)).toBe(0);
    const closed = (await api().get(`/api/jobs/${job.id}`).set(owner.auth)).body.job;
    expect(closed).toMatchObject({ status: "cancelled", cancelledBy: "system", expiresAt: null });
    expect(closed.cancellationReason).toMatch(/nobody was hired/);
    expect(await titles(bidder.user.id)).toContain("Job closed");
    expect(await titles(owner.user.id)).toContain("Job closed");
    expect((await rows(`SELECT "status" FROM "bids" WHERE "jobId" = $1`, [job.id]))[0]).toMatchObject({ status: "rejected" });
    expect(await rows(`SELECT 1 FROM "audit_logs" WHERE "action" = 'job_expire' AND "targetId" = $1`, [job.id])).toHaveLength(1);
    expect((await api().get(`/api/jobs/${hired.job.id}`).set(hired.owner.auth)).body.job.status).toBe("awarded");
    expect((await api().post(`/api/jobs/${job.id}/keep-open`).set(owner.auth)).status).toBe(409);
  });
});
