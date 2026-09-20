import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppDataSource } from "../src/data-source";
import { admin, api, awardedJob, createJob, placeBid, png, pro, type TestUser } from "./helpers";

/**
 * M-3: GET requests never change data. Builds a fixture in which every "read" could plausibly
 * have written something (unread messages, a viewed revised quote, invites, notifications,
 * disputes, reviews), snapshots every table, calls every GET route, and compares.
 */

const ROUTES_DIR = path.join(__dirname, "../src/routes");
const MOUNTS: Record<string, string> = {
  "admin.ts": "/api/admin",
  "auth.ts": "/api/auth",
  "bids.ts": "/api/bids",
  "disputes.ts": "/api/disputes",
  "favorites.ts": "/api/favorites",
  "files.ts": "/api/files",
  "jobs.ts": "/api/jobs",
  "messages.ts": "/api/messages",
  "notifications.ts": "/api/notifications",
  "profile.ts": "/api/profile",
  "reports.ts": "/api/reports",
  "reviews.ts": "/api/reviews",
};

function declaredGetRoutes(): string[] {
  const out = ["/health", "/uploads/:name"];
  for (const file of fs.readdirSync(ROUTES_DIR)) {
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), "utf8");
    expect(MOUNTS[file], `add ${file} to MOUNTS`).toBeTruthy();
    for (const m of src.matchAll(/router\.get\(\s*"([^"]+)"/g)) {
      out.push(`${MOUNTS[file]}${m[1] === "/" ? "" : m[1]}`);
    }
  }
  return out.sort();
}

async function snapshot() {
  const tables: { tablename: string }[] = await AppDataSource.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  const out: Record<string, string> = {};
  for (const { tablename } of tables) {
    const [row] = await AppDataSource.query(
      `SELECT COUNT(*)::int AS n, md5(COALESCE(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${tablename}" t`
    );
    out[tablename] = `${row.n}:${row.h}`;
  }
  return out;
}

describe("GET routes are read-only (M-3)", () => {
  it("no GET request changes any table", async () => {
    // ---- fixture ----
    const a = await admin();
    const hired = await awardedJob({ stage: "in_progress" });
    const { owner, worker, job: workJob } = hired;
    const done = await awardedJob({ stage: "completed" });
    await api().post(`/api/reviews/job/${done.job.id}`).set(done.owner.auth).send({ rating: 5, comment: "Great" });
    const disputed = await awardedJob({ stage: "in_progress" });
    await api().post(`/api/jobs/${disputed.job.id}/disputes`).set(disputed.owner.auth).send({ reason: "Work unfinished" }).expect(201);

    const openJob = await createJob(owner);
    const bidder: TestUser = await pro();
    const bid = await placeBid(bidder, openJob.id, { amount: 2000, quoteAmount: 2000 });
    await api().patch(`/api/bids/${bid.id}/quote`).set(bidder.auth).send({ quoteAmount: 1800 }).expect(200);
    await api().post(`/api/bids/${bid.id}/quote-viewed`).set(owner.auth).expect(200);
    const invitee = await pro();
    await api().post(`/api/jobs/${openJob.id}/invite-pro`).set(owner.auth).send({ tradespersonId: invitee.user.id }).expect(200);
    await api().post("/api/favorites").set(owner.auth).send({ targetType: "pro", targetId: worker.user.id }).expect(201);
    await api().post(`/api/messages/${workJob.id}`).set(worker.auth).send({ body: "Unread by the client" }).expect(201);
    await api().post("/api/reports").set(owner.auth).send({ targetType: "user", targetId: bidder.user.id, reason: "Spam messages" }).expect(201);
    const gallery = await api().post("/api/profile/gallery").set(worker.auth).attach("photos", await png(), { filename: "g.png", contentType: "image/png" });
    const fileName = String(gallery.body.profile.galleryUrls[0]).split("/").pop()!.split("?")[0];

    // ---- every GET route, as the users most likely to trigger side effects ----
    const calls: [pattern: string, url: string, who?: TestUser][] = [
      ["/health", "/health"],
      ["/uploads/:name", `/uploads/${fileName}`],
      ["/api/files/:name", `/api/files/${fileName}`],
      ["/api/admin/ping", "/api/admin/ping", a],
      ["/api/admin/stats", "/api/admin/stats", a],
      ["/api/admin/match-quality", "/api/admin/match-quality", a],
      ["/api/admin/match-weights", "/api/admin/match-weights", a],
      ["/api/admin/best-value-blend/preview", `/api/admin/best-value-blend/preview?jobId=${openJob.id}`, a],
      ["/api/admin/users", "/api/admin/users", a],
      ["/api/admin/tradespeople", "/api/admin/tradespeople", a],
      ["/api/admin/audit-logs", "/api/admin/audit-logs", a],
      ["/api/admin/reports", "/api/admin/reports", a],
      ["/api/auth/me", "/api/auth/me", owner],
      ["/api/auth/me/templates", "/api/auth/me/templates", owner],
      ["/api/bids/counter-analytics", "/api/bids/counter-analytics", bidder],
      ["/api/bids/:id/escrow-what-if", `/api/bids/${bid.id}/escrow-what-if`, owner],
      ["/api/bids/:id/viewed-no-reply", `/api/bids/${bid.id}/viewed-no-reply`, bidder],
      ["/api/disputes", "/api/disputes", a],
      ["/api/favorites", "/api/favorites", owner],
      ["/api/jobs", "/api/jobs", owner],
      ["/api/jobs", "/api/jobs?sort=distance&nearLat=12.97&nearLng=77.59", bidder],
      ["/api/jobs/invite-analytics", "/api/jobs/invite-analytics", owner],
      ["/api/jobs/shortlist-invite-analytics", "/api/jobs/shortlist-invite-analytics", owner],
      ["/api/jobs/counter-analytics", "/api/jobs/counter-analytics", owner],
      ["/api/jobs/:id", `/api/jobs/${openJob.id}`, invitee],
      ["/api/jobs/:id", `/api/jobs/${workJob.id}`, owner],
      ["/api/jobs/:id/suggested-pros", `/api/jobs/${openJob.id}/suggested-pros`, owner],
      ["/api/jobs/:id/shortlist-ranked", `/api/jobs/${openJob.id}/shortlist-ranked`, owner],
      ["/api/jobs/:id/invites", `/api/jobs/${openJob.id}/invites`, owner],
      ["/api/jobs/:id/invite-analytics", `/api/jobs/${openJob.id}/invite-analytics`, owner],
      ["/api/jobs/:id/shortlist-invite-analytics", `/api/jobs/${openJob.id}/shortlist-invite-analytics`, owner],
      ["/api/jobs/:id/bids", `/api/jobs/${openJob.id}/bids`, owner],
      ["/api/jobs/:id/bids", `/api/jobs/${openJob.id}/bids`, bidder],
      ["/api/jobs/:id/payments", `/api/jobs/${workJob.id}/payments`, owner],
      ["/api/jobs/:id/schedule", `/api/jobs/${workJob.id}/schedule`, worker],
      // Streams need a one-time ticket; without one they're refused before doing anything.
      ["/api/messages/:jobId/stream", `/api/messages/${workJob.id}/stream`],
      ["/api/messages/:jobId/threads", `/api/messages/${workJob.id}/threads`, owner],
      ["/api/messages/:jobId", `/api/messages/${workJob.id}?pro=${worker.user.id}`, owner],
      ["/api/messages/:jobId", `/api/messages/${workJob.id}`, worker],
      ["/api/notifications/stream", "/api/notifications/stream"],
      ["/api/notifications", "/api/notifications", worker],
      ["/api/profile/browse", "/api/profile/browse?nearLat=12.97&nearLng=77.59&sort=distance", owner],
      ["/api/profile/earnings", "/api/profile/earnings", done.worker],
      ["/api/profile/analytics", "/api/profile/analytics", done.worker],
      ["/api/profile/counter-analytics", "/api/profile/counter-analytics", bidder],
      ["/api/profile/user/:userId", `/api/profile/user/${worker.user.id}`, owner],
      ["/api/profile", "/api/profile", worker],
      ["/api/reviews/pro/:userId", `/api/reviews/pro/${done.worker.user.id}`, owner],
      ["/api/reviews/client/:userId", `/api/reviews/client/${done.owner.user.id}`, done.worker],
      ["/api/reviews/job/:jobId", `/api/reviews/job/${done.job.id}`, done.owner],
    ];

    // Every declared GET route is exercised.
    const covered = new Set(calls.map((c) => c[0]));
    expect(declaredGetRoutes().filter((r) => !covered.has(r))).toEqual([]);

    const before = await snapshot();
    const statuses: string[] = [];
    for (const [pattern, url, who] of calls) {
      const req = api().get(url);
      const res = await (who ? req.set(who.auth) : req);
      statuses.push(`${res.status} ${pattern}`);
    }
    const after = await snapshot();

    const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
    expect(changed, statuses.join("\n")).toEqual([]);
    // The sweep only proves something if the requests actually succeeded.
    const failed = statuses.filter((s) => !/^(200|401) /.test(s));
    expect(failed).toEqual([]);
  }, 120_000);
});
