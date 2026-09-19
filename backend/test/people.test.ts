import { describe, expect, it } from "vitest";
import { VerificationStatus } from "../src/entities/TradespersonProfile";
import { AppDataSource } from "../src/data-source";
import { acceptBid, admin, api, awardedJob, client, createJob, placeBid, pro, rows } from "./helpers";

const week = {
  mon: { enabled: true, start: "09:00", end: "18:00" },
  tue: { enabled: true, start: "09:00", end: "18:00" },
  wed: { enabled: true, start: "09:00", end: "18:00" },
  thu: { enabled: true, start: "09:00", end: "18:00" },
  fri: { enabled: true, start: "09:00", end: "18:00" },
  sat: { enabled: true, start: "09:00", end: "18:00" },
  sun: { enabled: true, start: "09:00", end: "18:00" },
};

describe("professional profiles (H-5)", () => {
  it("public profiles hide contact details, licence and exact location", async () => {
    const p = await pro({ name: "Arjun" });
    const viewer = await pro();
    const res = await api().get(`/api/profile/user/${p.user.id}`).set(viewer.auth);
    expect(res.status).toBe(200);
    expect(res.body.profile).not.toHaveProperty("email");
    expect(res.body.profile).not.toHaveProperty("phone");
    expect(res.body.profile).not.toHaveProperty("licenseDocUrl");
    expect(res.body.profile.lat).toBe(12.98);
    expect(res.body.contactRevealed).toBe(false);
  });

  it("reveals contact details to a client who hired the pro, and to admins", async () => {
    const { owner, worker } = await awardedJob();
    const hired = await api().get(`/api/profile/user/${worker.user.id}`).set(owner.auth);
    expect(hired.body.profile.email).toBe(worker.user.email);
    expect(hired.body.contactRevealed).toBe(true);
    const a = await admin();
    expect((await api().get(`/api/profile/user/${worker.user.id}`).set(a.auth)).body.profile.licenseDocUrl).toBeDefined();
  });

  it("unverified pros aren't publicly visible or browseable", async () => {
    const pending = await pro({ proStatus: VerificationStatus.PENDING, name: "Hidden Pending" });
    const c = await client();
    expect((await api().get(`/api/profile/user/${pending.user.id}`).set(c.auth)).status).toBe(404);
    expect((await api().get(`/api/profile/user/${pending.user.id}`).set(pending.auth)).status).toBe(200);
    expect((await api().get("/api/profile/browse?verified=0").set(c.auth)).status).toBe(403);
    const browse = await api().get("/api/profile/browse?q=Hidden").set(c.auth);
    expect(browse.body.pros).toHaveLength(0);
    const a = await admin();
    const all = await api().get("/api/profile/browse?verified=0&q=Hidden").set(a.auth);
    expect(all.body.pros).toHaveLength(1);
  });

  it("browse filters by skill, rating, distance and availability", async () => {
    const tag = `Zed${Date.now()}`;
    await pro({ name: `${tag} Near`, profile: { skills: "Electrical wiring", lat: 12.97, lng: 77.64, weeklyAvailability: week, averageRating: 4.5 } });
    await pro({ name: `${tag} Far`, profile: { skills: "Electrical, fans", lat: 13.5, lng: 78.2, weeklyAvailability: null, averageRating: 3 } });
    const c = await client();
    const all = await api().get(`/api/profile/browse?q=${tag}&skill=electrical`).set(c.auth);
    expect(all.body.pros.map((p: { name: string }) => p.name)).toEqual([`${tag} Near`, `${tag} Far`]);
    expect(JSON.stringify(all.body)).not.toMatch(/@test\.fixlocal/);
    const near = await api().get(`/api/profile/browse?q=${tag}&nearLat=12.97&nearLng=77.64&maxKm=20`).set(c.auth);
    expect(near.body.pros).toHaveLength(1);
    const rated = await api().get(`/api/profile/browse?q=${tag}&ratingMin=4`).set(c.auth);
    expect(rated.body.pros).toHaveLength(1);
    const available = await api().get(`/api/profile/browse?q=${tag}&availableThisWeek=1`).set(c.auth);
    expect(available.body.pros.map((p: { name: string }) => p.name)).toEqual([`${tag} Near`]);
    const heat = await api().get(`/api/profile/browse?q=${tag}&sort=heat`).set(c.auth);
    expect(heat.body.pros[0].availabilityHeat.clean).toBe(true);
    expect((await api().get(`/api/profile/browse?siteType=castle`).set(c.auth)).status).toBe(400);
  });

  it("validates profile edits", async () => {
    const p = await pro();
    const bad = [
      { yearsExperience: -1 },
      { hourlyRateMin: 900, hourlyRateMax: 100 },
      { lat: 95 },
      { weeklyAvailability: { mon: { enabled: true, start: "25:00", end: "10:00" } } },
      { blockedDates: ["next tuesday"] },
      { notInterestedCategories: ["gardening"] },
      { customRatePackages: [{ label: "Visit", amountMin: 500, amountMax: 100 }] },
      { bio: "x".repeat(2001) },
    ];
    for (const body of bad) {
      expect((await api().patch("/api/profile").set(p.auth).send(body)).status, JSON.stringify(body)).toBe(400);
    }
    const ok = await api()
      .patch("/api/profile")
      .set(p.auth)
      .send({
        bio: "Neat work",
        yearsExperience: 7,
        weeklyAvailability: { mon: { enabled: true, slots: [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "18:00" }] } },
        blockedDates: ["2026-12-25", "2026-12-25"],
        customRatePackages: [{ label: "Half day", amountMin: 1500 }],
      });
    expect(ok.status).toBe(200);
    expect(ok.body.profile.weeklyAvailability.mon.slots).toHaveLength(2);
    expect(ok.body.profile.weeklyAvailability.tue.enabled).toBe(false);
    expect(ok.body.profile.blockedDates).toEqual(["2026-12-25"]);
    expect(ok.body.profile.customRatePackages[0].id).toBeTruthy();
    expect(ok.body.profile.email).toBe(p.user.email);
  });

  it("only notifies saved-by clients when availability actually improves, at most daily (M-6)", async () => {
    const c = await client();
    const p = await pro({ profile: { weeklyAvailability: null } });
    await api().post("/api/favorites").set(c.auth).send({ targetType: "pro", targetId: p.user.id }).expect(201);
    await api().patch("/api/profile").set(p.auth).send({ weeklyAvailability: week }).expect(200);
    await api().patch("/api/profile").set(p.auth).send({ weeklyAvailability: { ...week, sun: { enabled: false } } }).expect(200);
    await api().patch("/api/profile").set(p.auth).send({ weeklyAvailability: week }).expect(200);
    const notes = await api().get("/api/notifications").set(c.auth);
    expect(notes.body.notifications.filter((n: { type: string }) => n.type === "pro_available")).toHaveLength(1);
  });

  it("new jobs don't notify other clients (M-6)", async () => {
    const c1 = await client();
    const c2 = await client();
    const job = await createJob(c1);
    const p = await pro();
    // c2 can't even save a job they can't see.
    expect((await api().post("/api/favorites").set(c2.auth).send({ targetType: "job", targetId: job.id })).status).toBe(404);
    await api().post("/api/favorites").set(p.auth).send({ targetType: "job", targetId: job.id }).expect(201);
    await createJob(c1, { title: "Another leak" });
    const n2 = await api().get("/api/notifications").set(c2.auth);
    const n3 = await api().get("/api/notifications").set(p.auth);
    expect(n2.body.notifications).toHaveLength(0);
    expect(n3.body.notifications).toHaveLength(0);
  });

  it("publishes a case study only with the client's consent (M-7)", async () => {
    const { owner, worker, job } = await awardedJob({ stage: "in_progress" });
    const { png } = await import("./helpers");
    await api()
      .post(`/api/jobs/${job.id}/completion-photos`)
      .set(worker.auth)
      .attach("after", await png(), { filename: "a.png", contentType: "image/png" })
      .expect(200);
    await api().post(`/api/jobs/${job.id}/mark-done`).set(worker.auth).expect(200);
    expect((await api().post(`/api/jobs/${job.id}/publish-case-study`).set(worker.auth).send({})).body.code).toBe("INVALID_STATUS");
    await api().post(`/api/jobs/${job.id}/confirm`).set(owner.auth).expect(200);
    expect((await api().post(`/api/jobs/${job.id}/publish-case-study`).set(worker.auth).send({})).body.code).toBe("PHOTO_CONSENT_REQUIRED");
    await api().post(`/api/jobs/${job.id}/photo-consent`).set(owner.auth).send({ consent: true }).expect(200);
    const res = await api().post(`/api/jobs/${job.id}/publish-case-study`).set(worker.auth).send({ title: "Sink fixed" });
    expect(res.status).toBe(200);
    const url = res.body.caseStudy.afterUrl as string;
    expect((await api().get(url)).status).toBe(200);
    const again = await api().post(`/api/jobs/${job.id}/publish-case-study`).set(worker.auth).send({ title: "Sink fixed v2" });
    expect(again.body.profile.caseStudies).toHaveLength(1);
    expect((await api().get(url)).status).toBe(404);
    expect((await api().post(`/api/jobs/${job.id}/publish-case-study`).set((await pro()).auth).send({})).status).toBe(403);
  });

  it("publishes the before/after pair the pro picked, using the URLs the app shows", async () => {
    const { owner, worker, job } = await awardedJob({ stage: "in_progress" });
    const { png, jpegWithGps } = await import("./helpers");
    await api()
      .post(`/api/jobs/${job.id}/completion-photos`)
      .set(worker.auth)
      .attach("after", await png(), { filename: "a1.png", contentType: "image/png" })
      .attach("after", await jpegWithGps(), { filename: "a2.jpg", contentType: "image/jpeg" })
      .expect(200);
    await api().post(`/api/jobs/${job.id}/mark-done`).set(worker.auth).expect(200);
    await api().post(`/api/jobs/${job.id}/confirm`).set(owner.auth).expect(200);
    await api().post(`/api/jobs/${job.id}/photo-consent`).set(owner.auth).send({ consent: true }).expect(200);

    // The app only ever sees signed URLs (…?exp=…&sig=…).
    const shown = (await api().get(`/api/jobs/${job.id}`).set(worker.auth)).body.job.afterPhotoUrls as string[];
    expect(shown).toHaveLength(2);
    expect(shown[1]).toMatch(/\?exp=\d+&sig=/);
    const picked = shown[1];

    const res = await api().post(`/api/jobs/${job.id}/publish-case-study`).set(worker.auth).send({ afterUrl: picked });
    expect(res.status).toBe(200);
    const bytes = async (url: string) => (await api().get(url).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    })).body as Buffer;
    const published = await bytes(res.body.caseStudy.afterUrl);
    expect(published.equals(await bytes(picked))).toBe(true);
    expect(published.equals(await bytes(shown[0]))).toBe(false);
  });

  it("earnings and analytics come from released escrow", async () => {
    const { worker } = await awardedJob({ stage: "completed", amount: 2500 });
    const other = await awardedJob({ stage: "in_progress", amount: 999 });
    void other;
    const earnings = await api().get("/api/profile/earnings").set(worker.auth);
    expect(earnings.body.earnings).toMatchObject({ totalEarned: 2500, completedJobs: 1 });
    const analytics = await api().get("/api/profile/analytics").set(worker.auth);
    expect(analytics.body.analytics).toMatchObject({ jobsWon: 1, totalBids: 1, winRate: 100, totalEarned: 2500 });
    expect(analytics.body.analytics.earningsOverTime.at(-1).amount).toBe(2500);
  });
});

describe("favorites", () => {
  it("saves pros and visible jobs with notes and tags", async () => {
    const c = await client();
    const p = await pro();
    const add = await api().post("/api/favorites").set(c.auth).send({ targetType: "pro", targetId: p.user.id, notes: "Good", tags: "Kitchen, fast lane,kitchen" });
    expect(add.status).toBe(201);
    expect(add.body.favorite.tags).toEqual(["kitchen", "fast-lane"]);
    await api().post("/api/favorites").set(c.auth).send({ targetType: "pro", targetId: p.user.id }).expect(201);
    const list = await api().get("/api/favorites?type=pro").set(c.auth);
    expect(list.body.favorites).toHaveLength(1);
    expect(list.body.favorites[0].pro).not.toHaveProperty("email");
    await api().patch("/api/favorites").set(c.auth).send({ targetType: "pro", targetId: p.user.id, notes: null, tags: [] }).expect(200);
    await api().delete(`/api/favorites?targetType=pro&targetId=${p.user.id}`).set(c.auth).expect(200);
    expect((await api().get("/api/favorites").set(c.auth)).body.favorites).toHaveLength(0);
    expect((await api().post("/api/favorites").set(c.auth).send({ targetType: "pro", targetId: c.user.id })).status).toBe(404);
  });

  it("a saved job that later becomes private is returned without details (H-4)", async () => {
    const owner = await client();
    const p = await pro();
    const job = await createJob(owner);
    await api().post("/api/favorites").set(p.auth).send({ targetType: "job", targetId: job.id }).expect(201);
    const winner = await pro();
    const bid = await placeBid(winner, job.id);
    await acceptBid(owner, bid.id);
    const list = await api().get("/api/favorites?type=job").set(p.auth);
    expect(list.body.favorites[0].job).toEqual({ id: job.id, title: expect.any(String), status: "awarded", unavailable: true });
  });
});

describe("invites (M-1)", () => {
  const invite = (auth: Record<string, string>, jobId: string, body: Record<string, unknown>) =>
    api().post(`/api/jobs/${jobId}/invite-pro`).set(auth).send(body);

  it("records invites in their own table even when the pro has match notifications off", async () => {
    const owner = await client();
    const p = await pro();
    await api().patch("/api/auth/me").set(p.auth).send({ notificationPrefs: { match: false } }).expect(200);
    const job = await createJob(owner);
    const res = await invite(owner.auth, job.id, { tradespersonId: p.user.id, message: "Please quote" });
    expect(res.status).toBe(200);
    expect(res.body.notificationId).toBeNull();
    const [row] = await rows<{ status: string }>(`SELECT "status" FROM "job_invites" WHERE "jobId" = $1`, [job.id]);
    expect(row.status).toBe("pending");
    expect((await invite(owner.auth, job.id, { tradespersonId: p.user.id })).body.code).toBe("ALREADY_INVITED");
  });

  it("handles decline, cooldown, re-invite and the per-job limit", async () => {
    const owner = await client();
    const p = await pro();
    const job = await createJob(owner);
    await invite(owner.auth, job.id, { tradespersonId: p.user.id }).expect(200);
    const opened = await api().post(`/api/jobs/${job.id}/invite-opened`).set(p.auth);
    expect(opened.body.firstOpen).toBe(true);
    await api().post(`/api/jobs/${job.id}/decline-invite`).set(p.auth).send({ reason: "busy", note: "Booked" }).expect(200);
    expect((await api().post(`/api/jobs/${job.id}/decline-invite`).set(p.auth).send({})).status).toBe(404);
    const cooldown = await invite(owner.auth, job.id, { tradespersonId: p.user.id });
    expect(cooldown.status).toBe(429);
    expect(cooldown.body.code).toBe("INVITE_COOLDOWN");
    await AppDataSource.query(`UPDATE "job_invites" SET "declinedAt" = now() - interval '2 hours' WHERE "jobId" = $1`, [job.id]);
    await invite(owner.auth, job.id, { tradespersonId: p.user.id }).expect(200);

    const list = await api().get(`/api/jobs/${job.id}/invites`).set(owner.auth);
    expect(list.body).toMatchObject({ used: 2, remaining: 18 });
    expect(list.body.invites[0]).toMatchObject({ status: "pending", inviteCount: 2, opened: true });
    expect(JSON.stringify(list.body)).not.toContain(p.user.email);

    const analytics = await api().get(`/api/jobs/${job.id}/invite-analytics`).set(owner.auth);
    expect(analytics.body).toMatchObject({ sent: 2, uniquePros: 1, opened: 1 });
    expect(analytics.body.openRate).toBeLessThanOrEqual(100);

    await AppDataSource.query(`UPDATE "job_invites" SET "inviteCount" = 20 WHERE "jobId" = $1`, [job.id]);
    const limited = await invite(owner.auth, job.id, { tradespersonId: (await pro()).user.id });
    expect(limited.body.code).toBe("INVITE_RATE_LIMIT");
  });

  it("bulk invites report per-pro results; bid-after-invite counts only later bids", async () => {
    const owner = await client();
    const early = await pro();
    const late = await pro();
    const pending = await pro({ proStatus: VerificationStatus.PENDING });
    const job = await createJob(owner);
    await placeBid(early, job.id);
    const res = await api()
      .post(`/api/jobs/${job.id}/invite-pros`)
      .set(owner.auth)
      .send({ tradespersonIds: [early.user.id, late.user.id, pending.user.id, late.user.id] });
    expect(res.body).toMatchObject({ sent: 2, failed: 1 });
    expect(res.body.results.find((r: { tradespersonId: string }) => r.tradespersonId === pending.user.id).code).toBe("PRO_NOT_FOUND");
    await placeBid(late, job.id);
    const analytics = await api().get(`/api/jobs/${job.id}/invite-analytics`).set(owner.auth);
    expect(analytics.body.bidAfterInvite).toBe(1);
    const overall = await api().get(`/api/jobs/invite-analytics`).set(owner.auth);
    expect(overall.body.sent).toBe(2);
  });

  it("the availability gate is decided server-side for shortlisted pros", async () => {
    const owner = await client();
    const busy = await pro({ profile: { weeklyAvailability: { mon: { enabled: true, start: "09:00", end: "10:00" } } } });
    await api().post("/api/favorites").set(owner.auth).send({ targetType: "pro", targetId: busy.user.id }).expect(201);
    const job = await createJob(owner);
    const res = await invite(owner.auth, job.id, { tradespersonId: busy.user.id, source: "bulk", minHeat: 0 });
    expect(res.body.code).toBe("SHORTLIST_HEAT_TOO_LOW");
    const ranked = await api().get(`/api/jobs/${job.id}/shortlist-ranked`).set(owner.auth);
    expect(ranked.body.shortlist[0].inviteBlockedByHeat).toBe(true);
  });

  it("a client can make the availability gate stricter, never looser", async () => {
    const owner = await client();
    const slot = { enabled: true, start: "09:00", end: "13:00" };
    const halfTime = await pro({
      profile: { weeklyAvailability: { mon: slot, tue: slot, wed: slot, thu: slot, fri: slot } },
    });
    await api().post("/api/favorites").set(owner.auth).send({ targetType: "pro", targetId: halfTime.user.id }).expect(201);
    const ranked = await api().get(`/api/jobs/${(await createJob(owner)).id}/shortlist-ranked`).set(owner.auth);
    const score = ranked.body.shortlist[0].availabilityHeat.score as number;
    expect(score).toBeGreaterThan(25);
    expect(score).toBeLessThan(100);

    const strict = await invite(owner.auth, (await createJob(owner)).id, {
      tradespersonId: halfTime.user.id,
      source: "shortlist",
      minHeat: score + 1,
    });
    expect(strict.status).toBe(400);
    expect(strict.body).toMatchObject({ code: "SHORTLIST_HEAT_TOO_LOW", minHeat: score + 1 });

    const lenient = await invite(owner.auth, (await createJob(owner)).id, {
      tradespersonId: halfTime.user.id,
      source: "shortlist",
      minHeat: 1,
    });
    expect(lenient.status).toBe(200);
    expect((await invite(owner.auth, (await createJob(owner)).id, { tradespersonId: halfTime.user.id, minHeat: 101 })).status).toBe(400);
  });

  it("only the owner can invite or see invites", async () => {
    const owner = await client();
    const other = await client();
    const job = await createJob(owner);
    const p = await pro();
    expect((await invite(other.auth, job.id, { tradespersonId: p.user.id })).status).toBe(403);
    expect((await api().get(`/api/jobs/${job.id}/invites`).set(other.auth)).status).toBe(403);
    expect((await api().get(`/api/jobs/invite-analytics?homeownerId=${owner.user.id}`).set(other.auth)).status).toBe(403);
    expect((await api().get(`/api/jobs/${job.id}/suggested-pros`).set(other.auth)).status).toBe(403);
  });
});

describe("matching (M-13)", () => {
  it("suggests pros whose skills match whole words", async () => {
    const owner = await client();
    const tag = Date.now().toString(36);
    await pro({ name: `ac-${tag}`, profile: { skills: "AC repair, fridge servicing", city: "Mysuru", lat: null, lng: null } });
    await pro({ name: `fac-${tag}`, profile: { skills: "Facility contractor", city: "Mysuru", lat: null, lng: null } });
    const job = await createJob(owner, { category: "appliance", city: "Pune", lat: null, lng: null });
    const res = await api().get(`/api/jobs/${job.id}/suggested-pros?limit=10`).set(owner.auth);
    const names = res.body.suggestions.map((s: { name: string }) => s.name);
    expect(names).toContain(`ac-${tag}`);
    expect(names).not.toContain(`fac-${tag}`);
    const hit = res.body.suggestions.find((s: { name: string }) => s.name === `ac-${tag}`);
    expect(hit.breakdown.skillHits).toEqual(expect.arrayContaining(["ac", "fridge"]));
  });
});

describe("admin", () => {
  it("finds users by id or by text, and treats wildcards literally", async () => {
    const a = await admin();
    const c = await client();
    const byId = await api().get(`/api/admin/users?q=${c.user.id}`).set(a.auth);
    expect(byId.status).toBe(200);
    expect(byId.body.users.map((u: { id: string }) => u.id)).toEqual([c.user.id]);
    const byEmail = await api().get(`/api/admin/users?q=${encodeURIComponent(c.user.email.slice(0, 12))}`).set(a.auth);
    expect(byEmail.body.users.some((u: { id: string }) => u.id === c.user.id)).toBe(true);
    const wildcard = await api().get(`/api/admin/users?q=${encodeURIComponent("%")}`).set(a.auth);
    expect(wildcard.body.users).toEqual([]);
  });

  it("suspending withdraws bids and hides the pro; unsuspending returns them to pending", async () => {
    const a = await admin();
    const owner = await client();
    const p = await pro();
    const job = await createJob(owner);
    const bid = await placeBid(p, job.id);
    await api().patch(`/api/admin/users/${p.user.id}/suspend`).set(a.auth).send({ suspended: true }).expect(200);
    const [b] = await rows<{ status: string }>(`SELECT "status" FROM "bids" WHERE "id" = $1`, [bid.id]);
    expect(b.status).toBe("withdrawn");
    const list = await api().get("/api/admin/tradespeople?status=suspended").set(a.auth);
    expect(list.body.tradespeople.some((t: { userId: string }) => t.userId === p.user.id)).toBe(true);
    await api().patch(`/api/admin/users/${p.user.id}/suspend`).set(a.auth).send({ suspended: false }).expect(200);
    const [prof] = await rows<{ verificationStatus: string }>(`SELECT "verificationStatus" FROM "tradesperson_profiles" WHERE "userId" = $1`, [p.user.id]);
    expect(prof.verificationStatus).toBe("pending");
    expect((await api().patch(`/api/admin/users/${a.user.id}/suspend`).set(a.auth).send({ suspended: true })).status).toBe(400);
  });

  it("verifying a pro lets them bid immediately and notifies them", async () => {
    const a = await admin();
    const owner = await client();
    const p = await pro({ proStatus: VerificationStatus.PENDING });
    const job = await createJob(owner);
    expect((await api().post(`/api/jobs/${job.id}/bids`).set(p.auth).send({ amount: 100 })).status).toBe(403);
    const res = await api().patch(`/api/admin/tradespeople/${p.user.id}/verify`).set(a.auth).send({ status: "verified" });
    expect(res.body.profile.verificationStatus).toBe("verified");
    expect((await api().post(`/api/jobs/${job.id}/bids`).set(p.auth).send({ amount: 100 })).status).toBe(201);
    expect((await api().patch(`/api/admin/tradespeople/${p.user.id}/verify`).set(a.auth).send({ status: "royal" })).status).toBe(400);
    const notes = await api().get("/api/notifications").set(p.auth);
    expect(notes.body.notifications.some((n: { title: string }) => n.title === "You're verified")).toBe(true);
  });

  it("force-cancel refunds escrow, closes disputes and notifies both sides", async () => {
    const a = await admin();
    const { owner, worker, job } = await awardedJob({ stage: "in_progress", amount: 2000 });
    await api().post(`/api/jobs/${job.id}/disputes`).set(owner.auth).field("reason", "No show").expect(201);
    const res = await api().post(`/api/admin/jobs/${job.id}/force-cancel`).set(a.auth).send({ reason: "Fraud check" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ previousStatus: "disputed", job: { status: "cancelled", paymentStatus: "refunded" } });
    const [d] = await rows<{ status: string }>(`SELECT "status" FROM "disputes" WHERE "jobId" = $1`, [job.id]);
    expect(d.status).toBe("resolved");
    const [log] = await rows<{ summary: string }>(`SELECT "summary" FROM "audit_logs" WHERE "action" = 'force_cancel' AND "targetId" = $1`, [job.id]);
    expect(log.summary).toContain("was disputed");
    for (const u of [owner, worker]) {
      const n = await api().get("/api/notifications").set(u.auth);
      expect(n.body.notifications[0].meta.forceCancelled).toBe(true);
    }
    expect((await api().post(`/api/admin/jobs/${job.id}/force-cancel`).set(a.auth).send({})).status).toBe(409);
  });

  it("stats use released escrow, and audit logs page", async () => {
    const a = await admin();
    await awardedJob({ stage: "completed", amount: 1234 });
    const stats = await api().get("/api/admin/stats").set(a.auth);
    expect(stats.body.stats.simulatedGMV).toBeGreaterThanOrEqual(1234);
    await api().post("/api/admin/audit-notes").set(a.auth).send({ note: "First" }).expect(201);
    await api().post("/api/admin/audit-notes").set(a.auth).send({ note: "Second" }).expect(201);
    const page1 = await api().get("/api/admin/audit-logs?action=admin_note&limit=1").set(a.auth);
    expect(page1.body.logs[0].summary).toBe("Second");
    const page2 = await api().get(`/api/admin/audit-logs?action=admin_note&limit=1&before=${encodeURIComponent(page1.body.nextBefore)}`).set(a.auth);
    expect(page2.body.logs[0].summary).toBe("First");
    const users = await api().get("/api/admin/users?role=homeowner&limit=5").set(a.auth);
    expect(users.body.users.length).toBeLessThanOrEqual(5);
    expect(users.body.total).toBeGreaterThan(0);
  });

  it("match weights can be updated and rolled back", async () => {
    const a = await admin();
    const up = await api().put("/api/admin/match-weights").set(a.auth).send({ preset: "speed" });
    expect(up.body.preset).toBe("speed");
    const logs = await api().get("/api/admin/audit-logs?action=match_weights_update").set(a.auth);
    const back = await api().post("/api/admin/match-weights/rollback").set(a.auth).send({ auditLogId: logs.body.logs[0].id });
    expect(back.status).toBe(200);
    expect(back.body.weights).toMatchObject({ skills: 35, rating: 25 });
    expect((await api().post("/api/admin/match-weights/rollback").set(a.auth).send({ auditLogId: "x" })).status).toBe(400);
    const q = await api().get("/api/admin/match-quality").set(a.auth);
    expect(q.status).toBe(200);
    expect(JSON.stringify(q.body)).not.toMatch(/@test\.fixlocal/);
  });

  it("reports go to the admin queue and can be resolved once", async () => {
    const a = await admin();
    const c = await client();
    const p = await pro();
    const r = await api().post("/api/reports").set(c.auth).send({ targetType: "user", targetId: p.user.id, reason: "Rude messages" });
    expect(r.status).toBe(201);
    expect((await api().post("/api/reports").set(c.auth).send({ targetType: "user", targetId: p.user.id, reason: "Again" })).status).toBe(409);
    expect((await api().post("/api/reports").set(c.auth).send({ targetType: "job", targetId: p.user.id, reason: "?" })).status).toBe(404);
    const queue = await api().get("/api/admin/reports?status=open").set(a.auth);
    expect(queue.body.reports[0]).toMatchObject({ reason: "Rude messages", reporter: { id: c.user.id } });
    await api().patch(`/api/admin/reports/${r.body.report.id}`).set(a.auth).send({ status: "resolved", resolutionNote: "Warned" }).expect(200);
    expect((await api().patch(`/api/admin/reports/${r.body.report.id}`).set(a.auth).send({ status: "dismissed" })).status).toBe(409);
    expect((await api().get("/api/admin/reports").set(c.auth)).status).toBe(403);
  });
});
