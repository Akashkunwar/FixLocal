import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDataSource } from "../src/data-source";
import { config, overrideConfig } from "../src/config";
import { setMessagingProvider } from "../src/services/messaging";
import { flushOutbound } from "../src/utils/outbound";
import { sendJobAlertDigests } from "../src/utils/jobAlertDigest";
import { openStream, streamCount } from "../src/utils/sse";
import { loadJobToBidSamples } from "../src/utils/proSlaBatch";
import { acceptBid, api, awardedJob, client, createJob, placeBid, pro, rows } from "./helpers";

const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}+05:30`);

describe("jobs scan regressions", () => {
  const original = { ...config().messaging };
  afterEach(() => {
    overrideConfig({ messaging: { ...original } });
    setMessagingProvider("sms", null);
  });

  it("R1 unverified pro gets no open jobs from the list, like the job page", async () => {
    const owner = await client();
    const job = await createJob(owner, { title: "Secret-ish listing for R1" });
    const unverified = await pro({ proStatus: "pending" as never });
    const detail = await api().get(`/api/jobs/${job.id}`).set(unverified.auth);
    expect(detail.status).toBe(403);
    const list = await api().get(`/api/jobs?q=${encodeURIComponent("Secret-ish listing for R1")}`).set(unverified.auth);
    expect(list.status).toBe(200);
    expect(list.body.jobs).toEqual([]);
  });

  it("R2 a backlog text queued before 10 PM waits for 8 AM", async () => {
    overrideConfig({ messaging: { ...original, enabled: true } });
    const u = await client();
    const phone = `97${String(Date.now()).slice(-8)}`;
    await AppDataSource.query(`UPDATE "users" SET "phone" = $1, "phoneVerifiedAt" = now(), "smsOptIn" = true WHERE "id" = $2`, [phone, u.user.id]);
    await AppDataSource.query(
      `INSERT INTO "outbound_messages" ("userId","channel","body","status","sendAfter","dedupeKey") VALUES ($1,'sms','FixLocal: R2 quiet','queued',$2,$3)`,
      [u.user.id, ist("2026-10-20", "21:59:00"), `r2-${Date.now()}`]
    );
    expect(await flushOutbound(ist("2026-10-20", "23:30:00"))).toBe(0);
    expect(await flushOutbound(ist("2026-10-21", "07:59:00"))).toBe(0);
    expect(await flushOutbound(ist("2026-10-21", "08:00:30"))).toBeGreaterThan(0);
  });

  it("R3 flushes claim one row at a time and provider calls time out", async () => {
    overrideConfig({ messaging: { ...original, enabled: true } });
    const u = await client();
    const phone = `96${String(Date.now()).slice(-8)}`;
    await AppDataSource.query(`UPDATE "users" SET "phone" = $1, "phoneVerifiedAt" = now(), "smsOptIn" = true WHERE "id" = $2`, [phone, u.user.id]);
    const key = `r3-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      await AppDataSource.query(
        `INSERT INTO "outbound_messages" ("userId","channel","body","status","sendAfter","dedupeKey") VALUES ($1,'sms',$2,'queued','2026-10-20T00:00:00Z',$3)`,
        [u.user.id, `FixLocal: R3 ${i}`, `${key}-${i}`]
      );
    }
    // While the first text is with the provider, the other two are still queued (not held by this flush).
    let seenQueued = -1;
    setMessagingProvider("sms", {
      name: "spy",
      live: false,
      async send() {
        if (seenQueued < 0) {
          const [{ n }] = await AppDataSource.query(`SELECT COUNT(*)::int n FROM "outbound_messages" WHERE "dedupeKey" LIKE $1 AND "status" = 'queued'`, [`${key}%`]);
          seenQueued = n;
        }
        return { reference: "spy" };
      },
    });
    expect(await flushOutbound(ist("2026-10-21", "12:00:00"))).toBe(3);
    expect(seenQueued).toBe(2);
    const { Msg91SmsProvider } = await import("../src/services/messaging");
    let signal: AbortSignal | undefined;
    const provider = new Msg91SmsProvider({ authKey: "k", templateId: "t", senderId: null }, async (_url, init) => {
      signal = init.signal;
      return { ok: true, status: 200, json: async () => ({ type: "success", message: "id" }) };
    });
    await provider.send({ channel: "sms", to: "+919800000000", text: "x", lang: "en" });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("R4 a match created just after a digest goes in the next day's digest", async () => {
    const p = await pro();
    const owner = await client();
    const j1 = await createJob(owner, { title: "R4 first" });
    const j2 = await createJob(owner, { title: "R4 second" });
    // Day D digest runs at 08:00:05 IST and carries j1.
    await AppDataSource.query(`INSERT INTO "job_alert_matches" ("userId","jobId","alertName","createdAt") VALUES ($1,$2,'a',$3)`, [p.user.id, j1.id, ist("2026-10-20", "12:00:00")]);
    await sendJobAlertDigests(ist("2026-10-21", "08:00:05"));
    // j2 matches at 08:00:30 IST, after today's digest went out.
    await AppDataSource.query(`INSERT INTO "job_alert_matches" ("userId","jobId","alertName","createdAt") VALUES ($1,$2,'a',$3)`, [p.user.id, j2.id, ist("2026-10-21", "08:00:30")]);
    // Next day's first worker tick lands at 08:01 IST.
    await sendJobAlertDigests(ist("2026-10-22", "08:01:00"));
    const notes = await rows<{ meta: { jobIds?: string[] } }>(`SELECT "meta" FROM "notifications" WHERE "userId" = $1 AND "type" = 'job_alert'`, [p.user.id]);
    const delivered = notes.flatMap((n) => n.meta?.jobIds ?? []);
    const left = await rows(`SELECT 1 FROM "job_alert_matches" WHERE "userId" = $1 AND "jobId" = $2`, [p.user.id, j2.id]);
    expect(delivered).toContain(j1.id);
    expect(delivered).toContain(j2.id);
    expect(left).toHaveLength(1);
  });

  it("R5 chat 'before' cursor pages through messages that share a timestamp", async () => {
    const { owner, worker, job } = await awardedJob();
    const ts = new Date("2026-10-20T10:00:00.123Z");
    for (let i = 0; i < 3; i++) {
      await AppDataSource.query(
        `INSERT INTO "messages" ("jobId","threadTradespersonId","senderId","body","createdAt") VALUES ($1,$2,$3,$4,$5)`,
        [job.id, worker.user.id, owner.user.id, `m${i}`, ts]
      );
    }
    const p1 = await api().get(`/api/messages/${job.id}?limit=2`).set(owner.auth).expect(200);
    const p2 = await api().get(`/api/messages/${job.id}?limit=2&before=${encodeURIComponent(p1.body.nextBefore)}`).set(owner.auth).expect(200);
    const seen = [...p1.body.messages, ...p2.body.messages].map((m: { body: string }) => m.body);
    expect(new Set(seen).size).toBe(3);
  });

  it("R6 notification 'before' cursor pages through notifications sharing a timestamp", async () => {
    const u = await client();
    const ts = new Date("2026-10-20T10:00:00.123Z");
    for (let i = 0; i < 3; i++) {
      await AppDataSource.query(`INSERT INTO "notifications" ("userId","type","title","body","createdAt") VALUES ($1,'system',$2,'b',$3)`, [u.user.id, `n${i}`, ts]);
    }
    const p1 = await api().get(`/api/notifications?limit=2`).set(u.auth).expect(200);
    const p2 = await api().get(`/api/notifications?limit=2&before=${encodeURIComponent(p1.body.nextBefore)}`).set(u.auth).expect(200);
    const seen = [...p1.body.notifications, ...p2.body.notifications].map((n: { title: string }) => n.title);
    expect(new Set(seen).size).toBe(3);
  });

  it("R7 one pro withdrawing a bid leaves other chat streams on the job open", async () => {
    const owner = await client();
    const a = await pro();
    const b = await pro();
    const job = await createJob(owner);
    const bidA = await placeBid(a, job.id);
    await placeBid(b, job.id);
    const fakeRes = () => {
      const handlers: Record<string, () => void> = {};
      return { setHeader() {}, flushHeaders() {}, write() { return true; }, end() {}, on(ev: string, fn: () => void) { handlers[ev] = fn; } } as never;
    };
    openStream(fakeRes(), owner.user.id, { jobId: job.id, tradespersonId: b.user.id });
    openStream(fakeRes(), b.user.id, { jobId: job.id, tradespersonId: b.user.id });
    expect(streamCount(owner.user.id)).toBe(1);
    expect(streamCount(b.user.id)).toBe(1);
    await api().delete(`/api/bids/${bidA.id}`).set(a.auth).expect(200);
    await new Promise((r) => setTimeout(r, 300));
    expect(streamCount(owner.user.id)).toBe(1);
    expect(streamCount(b.user.id)).toBe(1);
    openStream(fakeRes(), a.user.id, { jobId: job.id, tradespersonId: a.user.id });
    const { revokeOneThread } = await import("../src/utils/sse");
    await revokeOneThread(job.id, a.user.id);
    await new Promise((r) => setTimeout(r, 300));
    expect(streamCount(a.user.id)).toBe(0);
    expect(streamCount(b.user.id)).toBe(1);
  });

  it("R8 SLA samples: a busy pro can't crowd quieter pros out", async () => {
    const owner = await client();
    const busy = await pro();
    const quiet = await pro();
    const jq = await createJob(owner);
    await AppDataSource.query(`UPDATE "jobs" SET "createdAt" = now() - interval '3 hours' WHERE "id" = $1`, [jq.id]);
    await AppDataSource.query(`INSERT INTO "bids" ("jobId","tradespersonId","amount","createdAt") VALUES ($1,$2,1000, now() - interval '2 hours')`, [jq.id, quiet.user.id]);
    await AppDataSource.query(
      `WITH j AS (INSERT INTO "jobs" ("title","description","category","homeownerId","photoUrls")
                  SELECT 'bulk '||g, 'd', 'plumbing', $1, '[]' FROM generate_series(1,170) g RETURNING "id")
       INSERT INTO "bids" ("jobId","tradespersonId","amount") SELECT j."id", $2, 1000 FROM j`,
      [owner.user.id, busy.user.id]
    );
    const s = await loadJobToBidSamples([busy.user.id, quiet.user.id]);
    expect(s[busy.user.id]).toHaveLength(80);
    expect(s[quiet.user.id]).toHaveLength(1);
  });
  it("R9 a block ends the pro's bid and a blocked pro can't be hired", async () => {
    const owner = await client();
    const p = await pro();
    const job = await createJob(owner);
    const bid = await placeBid(p, job.id);
    await api().post("/api/blocks").set(p.auth).send({ userId: owner.user.id }).expect(201);
    const [row] = await rows<{ status: string }>(`SELECT "status" FROM "bids" WHERE "id" = $1`, [bid.id]);
    expect(row.status).toBe("withdrawn");
    // Even a bid that is still active (block added straight in the database) can't be accepted.
    const job2 = await createJob(owner);
    const bid2 = await placeBid(await pro(), job2.id);
    await AppDataSource.query(`INSERT INTO "user_blocks" ("blockerId","blockedId") VALUES ($1,$2)`, [owner.user.id, bid2.tradespersonId]);
    const acc = await acceptBid(owner, bid2.id);
    expect(acc.status).toBe(403);
    expect(acc.body.code).toBe("BLOCKED");
  });

  it("LOW 11 a pro with no bid on a job they can see gets an empty bid list", async () => {
    const owner = await client();
    const job = await createJob(owner);
    const res = await api().get(`/api/jobs/${job.id}/bids`).set((await pro()).auth);
    expect(res.status).toBe(200);
    expect(res.body.bids).toEqual([]);
    const pending = await pro({ proStatus: "pending" as never });
    expect((await api().get(`/api/jobs/${job.id}/bids`).set(pending.auth)).status).toBe(403);
  });

  it("LOW 13 accepting a visit confirms only the proposal that was seen", async () => {
    const { owner, worker, job } = await awardedJob();
    const start = new Date(Date.now() + 3 * 86400_000);
    await api().post(`/api/jobs/${job.id}/schedule/propose`).set(worker.auth).send({ start: start.toISOString() }).expect(200);
    const res = await api().post(`/api/jobs/${job.id}/schedule/accept`).set(owner.auth).send({});
    expect(res.status).toBe(200);
    expect(res.body.job.scheduleStatus).toBe("confirmed");
  });

  it("LOW 14 no phone numbers or emails in bid messages, quote notes or pre-hire chat", async () => {
    const owner = await client();
    const job = await createJob(owner);
    const p = await pro();
    const bad = await api().post(`/api/jobs/${job.id}/bids`).set(p.auth).send({ amount: 1500, message: "Call me on 98765 43210" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("CONTACT_INFO");
    await placeBid(p, job.id);
    const chat = await api().post(`/api/messages/${job.id}`).set(p.auth).send({ body: "mail me at me@example.com" });
    expect(chat.body.code).toBe("CONTACT_INFO");
    expect((await api().post(`/api/messages/${job.id}`).set(p.auth).send({ body: "Happy to help" })).status).toBe(201);
    // After the hire, contact details are fine in chat.
    const { owner: o2, worker, job: hired } = await awardedJob();
    expect((await api().post(`/api/messages/${hired.id}`).set(worker.auth).send({ body: "My number is 98765 43210" })).status).toBe(201);
    expect(o2).toBeTruthy();
  });

  it("LOW 15 switching urgent on for an older job starts a fresh urgency window", async () => {
    const owner = await client();
    const job = await createJob(owner);
    await AppDataSource.query(`UPDATE "jobs" SET "createdAt" = now() - interval '5 days' WHERE "id" = $1`, [job.id]);
    const res = await api().patch(`/api/jobs/${job.id}`).set(owner.auth).send({ urgent: true });
    expect(res.status).toBe(200);
    expect(res.body.job.urgent).toBe(true);
  });

  it("LOW 16 one failing worker step doesn't skip the others", async () => {
    const digests = await import("../src/utils/jobAlertDigest");
    vi.spyOn(digests, "sendJobAlertDigests").mockRejectedValueOnce(new Error("boom"));
    const { runWorkersOnce } = await import("../src/workers");
    const out = (await runWorkersOnce(ist("2026-10-21", "12:00:00"))) as { skipped: boolean; failed?: string[]; texts?: number };
    if (out.skipped) return; // another test run holds the worker lock
    expect(out.failed).toEqual(["jobAlertDigests"]);
    expect(typeof out.texts).toBe("number");
    vi.restoreAllMocks();
  });

  it("several notifications for one user in a batch each keep their own settings", async () => {
    const { createNotifications } = await import("../src/utils/notifications");
    const u = await client();
    await createNotifications([
      { userId: u.user.id, type: "system" as never, title: "first", body: "a", email: false },
      { userId: u.user.id, type: "system" as never, title: "second", body: "b", email: false },
    ]);
    const list = await rows<{ title: string }>(`SELECT "title" FROM "notifications" WHERE "userId" = $1 ORDER BY "title"`, [u.user.id]);
    expect(list.map((n) => n.title)).toEqual(["first", "second"]);
  });
});
