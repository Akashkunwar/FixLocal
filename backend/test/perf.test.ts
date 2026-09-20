import { describe, expect, it, vi } from "vitest";
import { AppDataSource } from "../src/data-source";
import { api, client, pro } from "./helpers";
import { flushTestCache } from "../src/utils/cache";

/**
 * M-4: list endpoints stay fast and bounded with a realistic amount of data.
 * Budgets are 300 ms on a developer machine; CI runners are slower and add coverage
 * instrumentation, so CI sets PERF_BUDGET_SCALE. Query counts are exact regardless of speed:
 * a per-row (N+1) query would show up as hundreds of queries.
 */
const BUDGET_MS = 300 * Number(process.env.PERF_BUDGET_SCALE || 1);
describe("performance smoke", () => {
  it("browses 2,000 jobs and 500 pros quickly", async () => {
    const owner = await client();
    await AppDataSource.query(
      `INSERT INTO "jobs" ("title", "description", "category", "homeownerId", "lat", "lng", "city", "area", "budgetMin", "budgetMax", "photoUrls")
       SELECT 'Perf job ' || g, 'Seeded for performance', 'plumbing', $1,
              12.8 + random() * 0.4, 77.4 + random() * 0.4, 'Bengaluru', 'Area ' || (g % 20), 100 + g, 5000 + g, '[]'
       FROM generate_series(1, 2000) g`,
      [owner.user.id]
    );
    await AppDataSource.query(
      `WITH u AS (
         INSERT INTO "users" ("email", "passwordHash", "role", "name", "emailVerifiedAt")
         SELECT 'perf-pro-' || g || '@test.fixlocal', 'x', 'TRADESPERSON', 'Perf Pro ' || g, now()
         FROM generate_series(1, 500) g
         RETURNING "id"
       )
       INSERT INTO "tradesperson_profiles" ("userId", "skills", "city", "lat", "lng", "verificationStatus", "galleryUrls")
       SELECT "id", 'Plumbing, pipes', 'Bengaluru', 12.8 + random() * 0.4, 77.4 + random() * 0.4, 'verified', '[]' FROM u`
    );
    const p = await pro();
    const logQuery = vi.spyOn(AppDataSource.logger, "logQuery");
    // Warm up once, then clear the caches so the timed call takes the full database path
    // (including the auth-state lookup) — the worst case, not a cache hit.
    const time = async (url: string, auth: Record<string, string>) => {
      await api().get(url).set(auth);
      await flushTestCache();
      logQuery.mockClear();
      const t0 = performance.now();
      const res = await api().get(url).set(auth);
      expect(res.status).toBe(200);
      const ms = performance.now() - t0;
      return { ms, queries: logQuery.mock.calls.length, body: res.body };
    };
    const byDistance = await time("/api/jobs?sort=distance&nearLat=13&nearLng=77.6&maxKm=15&limit=20", p.auth);
    expect(byDistance.body.jobs.length).toBeLessThanOrEqual(20);
    expect(byDistance.body.pagination.total).toBeGreaterThan(0);
    expect(byDistance.ms).toBeLessThan(BUDGET_MS);
    expect(byDistance.queries).toBeLessThanOrEqual(6);

    const browse = await time("/api/profile/browse?nearLat=13&nearLng=77.6&maxKm=15&sort=distance", owner.auth);
    expect(browse.body.pros.length).toBeLessThanOrEqual(40);
    expect(browse.ms).toBeLessThan(BUDGET_MS);
    expect(browse.queries).toBeLessThanOrEqual(6);

    const job = (await api().post("/api/jobs").set(owner.auth).send({ title: "Perf leak", description: "d", category: "plumbing", city: "Bengaluru", lat: 13, lng: 77.6 })).body.job;
    const suggested = await time(`/api/jobs/${job.id}/suggested-pros?limit=10`, owner.auth);
    expect(suggested.body.suggestions).toHaveLength(10);
    expect(suggested.ms).toBeLessThan(BUDGET_MS);
    expect(suggested.queries).toBeLessThanOrEqual(10);
  }, 120_000);
});
