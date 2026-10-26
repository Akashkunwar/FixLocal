import { describe, expect, it } from "vitest";
import { VerificationStatus } from "../src/entities/TradespersonProfile";
import { alertMatchesJob } from "../src/utils/jobAlerts";
import { api, client, createJob, pro, rows } from "./helpers";

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
      .send({ name: "Plumbing near me", categories: ["plumbing"], lat: 12.9784, lng: 77.6408, radiusKm: 5 });
    expect(created.status).toBe(201);
    // A second, overlapping alert must not double-notify.
    await api().post("/api/job-alerts").set(p.auth).send({ name: "Anything in Bengaluru", city: "Bengaluru" }).expect(201);

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
      await api().post("/api/job-alerts").set(p.auth).send({ name: "All", city: "Bengaluru" }).expect(201);
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
