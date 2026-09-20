import { describe, expect, it } from "vitest";
import { VerificationStatus } from "../src/entities/TradespersonProfile";
import { admin, api, client, createJob, jobInput, placeBid, pro, rows } from "./helpers";

describe("creating and editing jobs", () => {
  it("creates a job and returns full detail to the owner", async () => {
    const c = await client();
    const res = await api().post("/api/jobs").set(c.auth).send(jobInput({ siteType: "office", cadence: "monthly" }));
    expect(res.status).toBe(201);
    expect(res.body.job).toMatchObject({
      status: "open",
      address: "12 Private Lane, Flat 4B",
      budgetMin: 500,
      budgetMax: 2000,
      maxBids: 5,
      siteType: "office",
      cadence: "monthly",
      exactLocation: true,
    });
  });

  it("rejects invalid jobs (H-10)", async () => {
    const c = await client();
    const bad = [
      jobInput({ budgetMin: -500 }),
      jobInput({ budgetMin: 900, budgetMax: 100 }),
      jobInput({ maxBids: -3 }),
      jobInput({ maxBids: 500 }),
      jobInput({ category: "gardening" }),
      jobInput({ title: "" }),
      jobInput({ title: "x".repeat(121) }),
      jobInput({ description: "x".repeat(5001) }),
      jobInput({ lat: 123 }),
      jobInput({ preferredStart: "2026-10-10", preferredEnd: "2026-10-01" }),
      jobInput({ preferredStart: "yesterday-ish" }),
      jobInput({ pincode: "<b>" }),
    ];
    for (const body of bad) {
      const res = await api().post("/api/jobs").set(c.auth).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("only clients can post jobs", async () => {
    const p = await pro();
    const a = await admin();
    expect((await api().post("/api/jobs").set(p.auth).send(jobInput())).status).toBe(403);
    expect((await api().post("/api/jobs").set(a.auth).send(jobInput())).status).toBe(403);
    expect((await api().post("/api/jobs").send(jobInput())).status).toBe(401);
  });

  it("lets the owner edit an open job and clear fields", async () => {
    const c = await client();
    const job = await createJob(c);
    const res = await api()
      .patch(`/api/jobs/${job.id}`)
      .set(c.auth)
      .send({ title: "Updated title", budgetMax: 3000, siteType: "", address: null });
    expect(res.status).toBe(200);
    expect(res.body.job).toMatchObject({ title: "Updated title", budgetMax: 3000, siteType: null, address: null });
    const bad = await api().patch(`/api/jobs/${job.id}`).set(c.auth).send({ budgetMin: 5000 });
    expect(bad.status).toBe(400);
  });

  it("stops other users from editing or cancelling", async () => {
    const owner = await client();
    const other = await client();
    const job = await createJob(owner);
    expect((await api().patch(`/api/jobs/${job.id}`).set(other.auth).send({ title: "Mine now" })).status).toBe(403);
    expect((await api().post(`/api/jobs/${job.id}/cancel`).set(other.auth)).status).toBe(403);
  });

  it("cancelling closes active bids and notifies bidders (L-8)", async () => {
    const owner = await client();
    const p = await pro();
    const job = await createJob(owner);
    const bid = await placeBid(p, job.id);
    const res = await api().post(`/api/jobs/${job.id}/cancel`).set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe("cancelled");
    const [b] = await rows<{ status: string }>(`SELECT "status" FROM "bids" WHERE "id" = $1`, [bid.id]);
    expect(b.status).toBe("rejected");
    const notes = await api().get("/api/notifications").set(p.auth);
    expect(notes.body.notifications.some((n: { meta: { jobCancelled?: boolean } }) => n.meta?.jobCancelled)).toBe(true);
    expect((await api().post(`/api/jobs/${job.id}/cancel`).set(owner.auth)).status).toBe(409);
    expect((await api().patch(`/api/jobs/${job.id}`).set(owner.auth).send({ title: "x" })).status).toBe(409);
  });

  it("photo consent can only be set by the owner", async () => {
    const owner = await client();
    const job = await createJob(owner);
    const p = await pro();
    expect((await api().post(`/api/jobs/${job.id}/photo-consent`).set(p.auth).send({ consent: true })).status).toBe(403);
    const res = await api().post(`/api/jobs/${job.id}/photo-consent`).set(owner.auth).send({ consent: true });
    expect(res.body.job.photoConsent).toBe(true);
  });
});

describe("listing and viewing jobs", () => {
  it("clients only ever see their own jobs, including from the open-jobs cache (C-3)", async () => {
    const a = await client();
    const b = await client();
    await createJob(a, { title: "A's job" });
    await createJob(b, { title: "B's job" });
    const first = await api().get("/api/jobs?status=open&limit=50").set(a.auth);
    const second = await api().get("/api/jobs?status=open&limit=50").set(b.auth);
    expect(first.body.jobs.every((j: { homeownerId: string }) => j.homeownerId === a.user.id)).toBe(true);
    expect(second.body.jobs.every((j: { homeownerId: string }) => j.homeownerId === b.user.id)).toBe(true);
    expect(second.body.cached).toBe(false);
  });

  it("pro browse is cached but reflects filters and edits immediately (C-3)", async () => {
    const owner = await client();
    const p = await pro();
    const job = await createJob(owner, { title: "Cache check original", siteType: "office" });
    await createJob(owner, { title: "Cache check residential", siteType: "residential" });
    const all = await api().get("/api/jobs?q=Cache%20check").set(p.auth);
    const again = await api().get("/api/jobs?q=Cache%20check").set(p.auth);
    expect(again.body.cached).toBe(true);
    expect(all.body.jobs).toHaveLength(2);
    const office = await api().get("/api/jobs?q=Cache%20check&siteType=office").set(p.auth);
    expect(office.body.jobs).toHaveLength(1);

    await api().patch(`/api/jobs/${job.id}`).set(owner.auth).send({ title: "Cache check renamed" }).expect(200);
    const fresh = await api().get("/api/jobs?q=Cache%20check").set(p.auth);
    expect(fresh.body.jobs.map((j: { title: string }) => j.title)).toContain("Cache check renamed");
  });

  it("a pro's 'mine' list never pollutes the shared browse cache", async () => {
    const owner = await client();
    const p = await pro();
    await createJob(owner, { title: "Pollution test" });
    const mine = await api().get("/api/jobs?scope=mine&status=open&q=Pollution").set(p.auth);
    expect(mine.body.jobs).toHaveLength(0);
    const browse = await api().get("/api/jobs?status=open&q=Pollution").set(p.auth);
    expect(browse.body.jobs).toHaveLength(1);
  });

  it("pros see listings without the exact address (H-5)", async () => {
    const owner = await client();
    const p = await pro();
    const job = await createJob(owner);
    const list = await api().get("/api/jobs?q=leaking").set(p.auth);
    const item = list.body.jobs.find((j: { id: string }) => j.id === job.id);
    expect(item.address).toBeNull();
    expect(item.lat).toBe(12.98);
    expect(item.exactLocation).toBe(false);
    expect(item).not.toHaveProperty("escrowAmount");
    const detail = await api().get(`/api/jobs/${job.id}`).set(p.auth);
    expect(detail.body.job.address).toBeNull();
    expect(detail.body.access).toBe("listing");
  });

  it("unverified pros can't open job details (H-5)", async () => {
    const owner = await client();
    const job = await createJob(owner);
    const pending = await pro({ proStatus: VerificationStatus.PENDING });
    const res = await api().get(`/api/jobs/${job.id}`).set(pending.auth);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_VERIFIED");
  });

  it("other clients can't view a job; admins see everything", async () => {
    const owner = await client();
    const other = await client();
    const a = await admin();
    const job = await createJob(owner);
    expect((await api().get(`/api/jobs/${job.id}`).set(other.auth)).status).toBe(403);
    const asAdmin = await api().get(`/api/jobs/${job.id}`).set(a.auth);
    expect(asAdmin.body.job.address).toBe("12 Private Lane, Flat 4B");
  });

  it("searches, filters, sorts and paginates", async () => {
    const owner = await client();
    const p = await pro();
    const tag = `Zeta${Date.now()}`;
    await createJob(owner, { title: `${tag} cheap`, budgetMin: 100, budgetMax: 200, lat: 12.9, lng: 77.6 });
    await createJob(owner, { title: `${tag} pricey`, budgetMin: 5000, budgetMax: 9000, lat: 13.2, lng: 77.9 });
    await createJob(owner, { title: `${tag} wiring`, category: "electrical", budgetMax: 800, lat: null, lng: null });

    const byBudget = await api().get(`/api/jobs?q=${tag}&sort=budget_desc`).set(p.auth);
    expect(byBudget.body.jobs[0].title).toContain("pricey");
    const cat = await api().get(`/api/jobs?q=${tag}&category=electrical`).set(p.auth);
    expect(cat.body.jobs).toHaveLength(1);
    const budget = await api().get(`/api/jobs?q=${tag}&budgetMin=1000`).set(p.auth);
    expect(budget.body.jobs.map((j: { title: string }) => j.title)).toEqual([`${tag} pricey`]);
    const page = await api().get(`/api/jobs?q=${tag}&limit=2&page=2`).set(p.auth);
    expect(page.body.jobs).toHaveLength(1);
    expect(page.body.pagination).toMatchObject({ total: 3, totalPages: 2, page: 2 });

    const near = await api().get(`/api/jobs?q=${tag}&sort=distance&nearLat=12.9&nearLng=77.6`).set(p.auth);
    expect(near.body.jobs[0].title).toContain("cheap");
    expect(near.body.jobs[0].distanceKm).toBe(0);
    expect(near.body.jobs[2].distanceKm).toBeNull();
    const within = await api().get(`/api/jobs?q=${tag}&nearLat=12.9&nearLng=77.6&maxKm=10`).set(p.auth);
    expect(within.body.jobs).toHaveLength(1);

    const like = await api().get(`/api/jobs?q=%25`).set(p.auth);
    expect(like.status).toBe(200);
  });

  it("GET requests don't change data (M-3)", async () => {
    const { awardedJob } = await import("./helpers");
    const { owner, worker, job } = await awardedJob({ stage: "in_progress" });
    const before = await rows(
      `SELECT (SELECT COUNT(*) FROM payment_milestones) m, (SELECT COUNT(*) FROM notifications) n,
              (SELECT MAX("updatedAt") FROM jobs) j, (SELECT MAX("updatedAt") FROM bids) b,
              (SELECT COUNT(*) FROM chat_thread_reads) r`
    );
    const gets = [
      `/api/jobs/${job.id}`,
      `/api/jobs/${job.id}/bids`,
      `/api/jobs/${job.id}/payments`,
      `/api/jobs/${job.id}/schedule`,
      `/api/messages/${job.id}`,
      `/api/messages/${job.id}/threads`,
      `/api/reviews/job/${job.id}`,
      `/api/jobs`,
      `/api/notifications`,
    ];
    for (const url of gets) {
      await api().get(url).set(owner.auth);
      await api().get(url).set(worker.auth);
    }
    const after = await rows(
      `SELECT (SELECT COUNT(*) FROM payment_milestones) m, (SELECT COUNT(*) FROM notifications) n,
              (SELECT MAX("updatedAt") FROM jobs) j, (SELECT MAX("updatedAt") FROM bids) b,
              (SELECT COUNT(*) FROM chat_thread_reads) r`
    );
    expect(after).toEqual(before);
  });
});
