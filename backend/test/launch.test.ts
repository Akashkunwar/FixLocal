import { describe, expect, it, vi } from "vitest";
import { acceptBid, admin, api, awardedJob, client, createJob, placeBid, pro, rows } from "./helpers";
import { AppDataSource } from "../src/data-source";
import { loadConfig } from "../src/config";
import { consoleMailer } from "../src/services/mailer";
import { setErrorReporter } from "../src/services/errorReporter";
import { errorHandler } from "../src/middleware/error";
import { SimulatedPaymentProvider, setPaymentProvider, type PaymentProvider } from "../src/services/payments";
import { TERMS_VERSION } from "../src/domain/legal";
import { uniqueEmail } from "./helpers";

const milestones = (jobId: string) =>
  rows<{ id: string; sequence: number; status: string }>(
    `SELECT "id", "sequence", "status" FROM "payment_milestones" WHERE "jobId" = $1 ORDER BY "sequence"`,
    [jobId]
  );
const jobRow = async (id: string) =>
  (await rows<{ status: string; paymentStatus: string; cancelledBy: string | null; cancellationReason: string | null }>(
    `SELECT "status", "paymentStatus", "cancelledBy", "cancellationReason" FROM "jobs" WHERE "id" = $1`,
    [id]
  ))[0];

describe("calling off a hire before work starts", () => {
  it("the client cancels: held escrow is refunded, a released deposit stays with the pro, the pro is told", async () => {
    const { owner, worker, job } = await awardedJob({ amount: 1000 });
    const [deposit] = await milestones(job.id);
    await api().post(`/api/jobs/${job.id}/payments/${deposit.id}/release`).set(owner.auth).expect(200);

    const res = await api().post(`/api/jobs/${job.id}/cancel-booking`).set(owner.auth).send({ reason: "Fixed it myself" });
    expect(res.status).toBe(200);
    expect(res.body.refunded).toBe(700);
    expect(res.body.job).toMatchObject({ status: "cancelled", cancelledBy: "client", cancellationReason: "Fixed it myself" });
    expect((await milestones(job.id)).map((m) => m.status)).toEqual(["released", "refunded", "refunded"]);
    expect((await jobRow(job.id)).paymentStatus).toBe("partially_released");

    const ledger = await rows<{ type: string; amount: string }>(
      `SELECT "type", "amount" FROM "ledger_entries" WHERE "jobId" = $1 AND "type" = 'refund'`,
      [job.id]
    );
    expect(ledger.reduce((s, r) => s + Number(r.amount), 0)).toBe(700);
    const [note] = await rows<{ title: string; body: string }>(
      `SELECT "title", "body" FROM "notifications" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      [worker.user.id]
    );
    expect(note.title).toBe("Booking cancelled");
    expect(note.body).toMatch(/Fixed it myself/);
  });

  it("the hired pro can back out too, and the client gets everything back", async () => {
    const { owner, worker, job } = await awardedJob({ amount: 2000 });
    const res = await api().post(`/api/jobs/${job.id}/cancel-booking`).set(worker.auth).send({});
    expect(res.status).toBe(200);
    expect(res.body.refunded).toBe(2000);
    expect((await jobRow(job.id))).toMatchObject({ status: "cancelled", paymentStatus: "refunded", cancelledBy: "professional" });
    const [note] = await rows<{ title: string }>(
      `SELECT "title" FROM "notifications" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      [owner.user.id]
    );
    expect(note.title).toBe("Booking cancelled");
  });

  it("is refused once work has started, and for anyone else", async () => {
    const { owner, worker, job } = await awardedJob({ stage: "in_progress" });
    expect((await api().post(`/api/jobs/${job.id}/cancel-booking`).set(owner.auth).send({})).status).toBe(409);
    expect((await api().post(`/api/jobs/${job.id}/cancel-booking`).set(worker.auth).send({})).status).toBe(409);
    const other = await awardedJob();
    expect((await api().post(`/api/jobs/${other.job.id}/cancel-booking`).set((await pro()).auth).send({})).status).toBe(403);
    expect((await api().post(`/api/jobs/${other.job.id}/cancel-booking`).set((await client()).auth).send({})).status).toBe(403);
  });

  it("two cancels racing refund exactly once", async () => {
    const { owner, worker, job } = await awardedJob({ amount: 1500 });
    const results = await Promise.all([
      api().post(`/api/jobs/${job.id}/cancel-booking`).set(owner.auth).send({}),
      api().post(`/api/jobs/${job.id}/cancel-booking`).set(worker.auth).send({}),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const refunds = await rows(`SELECT 1 FROM "ledger_entries" WHERE "jobId" = $1 AND "type" = 'refund'`, [job.id]);
    expect(refunds).toHaveLength(3);
  });
});

describe("terms of service consent", () => {
  it("registration records the accepted version; legacy accounts accept once", async () => {
    const email = uniqueEmail("terms");
    await api()
      .post("/api/auth/register")
      .send({ email, password: "Long-enough-pass-9", role: "HOMEOWNER", acceptTerms: true })
      .expect(202);
    const [row] = await rows<{ termsVersion: string; termsAcceptedAt: Date }>(
      `SELECT "termsVersion", "termsAcceptedAt" FROM "users" WHERE "email" = $1`,
      [email]
    );
    expect(row.termsVersion).toBe(TERMS_VERSION);
    expect(row.termsAcceptedAt).toBeTruthy();

    const legacy = await client();
    expect((await api().get("/api/auth/me").set(legacy.auth)).body.user.termsAccepted).toBe(false);
    const accepted = await api().post("/api/auth/accept-terms").set(legacy.auth).expect(200);
    expect(accepted.body.user.termsAccepted).toBe(true);
  });
});

describe("data export (DPDP right to access)", () => {
  it("returns the user's own data as a download, without secrets or other people's contact details", async () => {
    const { owner, worker, job } = await awardedJob({ stage: "in_progress" });
    await api().post(`/api/messages/${job.id}`).set(owner.auth).send({ body: "Gate code is 1234" }).expect(201);
    const res = await api().get("/api/auth/me/export").set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="fixlocal-data-/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.account.email).toBe(owner.user.email);
    expect(res.body.jobsPosted.map((j: { id: string }) => j.id)).toContain(job.id);
    expect(res.body.messagesSent.map((m: { body: string }) => m.body)).toContain("Gate code is 1234");
    expect(res.body.escrowLedger.length).toBeGreaterThan(0);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(worker.user.email);
    expect(text).not.toMatch(/passwordHash|tokenHash/);

    const proExport = await api().get("/api/auth/me/export").set(worker.auth).expect(200);
    expect(proExport.body.professionalProfile.userId).toBe(worker.user.id);
    expect(proExport.body.bids).toHaveLength(1);
    expect((await api().get("/api/auth/me/export")).status).toBe(401);
  });
});

describe("blocking another user", () => {
  it("stops bids, invites and new messages both ways, and can be undone", async () => {
    const owner = await client();
    const p = await pro();
    const job = await createJob(owner);
    await api().post("/api/blocks").set(owner.auth).send({ userId: p.user.id }).expect(201);
    await api().post("/api/blocks").set(owner.auth).send({ userId: p.user.id }).expect(201); // idempotent
    expect((await api().get("/api/blocks").set(owner.auth)).body.blocks).toMatchObject([{ userId: p.user.id }]);

    const bid = await api().post(`/api/jobs/${job.id}/bids`).set(p.auth).send({ amount: 900 });
    expect(bid.status).toBe(403);
    expect(bid.body.code).toBe("BLOCKED");
    const invite = await api().post(`/api/jobs/${job.id}/invite-pro`).set(owner.auth).send({ tradespersonId: p.user.id });
    expect(invite.status).toBe(403);

    await api().delete(`/api/blocks/${p.user.id}`).set(owner.auth).expect(200);
    await placeBid(p, job.id, { amount: 900 });
    await api().post(`/api/messages/${job.id}`).set(p.auth).send({ body: "Hello" }).expect(201);

    // The pro blocks the client: the client can still read the thread but not write to it.
    await api().post("/api/blocks").set(p.auth).send({ userId: owner.user.id }).expect(201);
    const read = await api().get(`/api/messages/${job.id}?pro=${p.user.id}`).set(owner.auth).expect(200);
    expect(read.body.canSend).toBe(false);
    expect((await api().post(`/api/messages/${job.id}?pro=${p.user.id}`).set(owner.auth).send({ body: "Hi?" })).status).toBe(403);
  });

  it("can't block yourself or support staff, and admins can't use it", async () => {
    const owner = await client();
    const a = await admin();
    expect((await api().post("/api/blocks").set(owner.auth).send({ userId: owner.user.id })).status).toBe(400);
    expect((await api().post("/api/blocks").set(owner.auth).send({ userId: a.user.id })).status).toBe(400);
    expect((await api().post("/api/blocks").set(owner.auth).send({ userId: crypto.randomUUID() })).status).toBe(404);
    expect((await api().get("/api/blocks").set(a.auth)).status).toBe(403);
  });
});

describe("email notifications", () => {
  it("important updates are emailed to verified users who haven't opted out", async () => {
    const owner = await client();
    const worker = await pro();
    const job = await createJob(owner);
    const bid = await placeBid(worker, job.id);
    const mailsTo = (email: string) => consoleMailer.outbox.filter((m) => m.to === email);
    await vi.waitFor(() => expect(mailsTo(owner.user.email).some((m) => /New bid/.test(m.subject))).toBe(true));
    expect(mailsTo(owner.user.email)[0].text).toContain(`/client/jobs/${job.id}`);
    expect(mailsTo(owner.user.email)[0].text).toContain("/settings");

    await api().patch("/api/auth/me").set(worker.auth).send({ emailNotifications: false }).expect(200);
    expect((await api().get("/api/auth/me").set(worker.auth)).body.user.emailNotifications).toBe(false);
    expect((await acceptBid(owner, bid.id)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(mailsTo(worker.user.email).some((m) => /accepted/i.test(m.subject))).toBe(false);
    // ...but the in-app notification still arrives.
    const inApp = await rows(`SELECT 1 FROM "notifications" WHERE "userId" = $1 AND "type" = 'bid_accepted'`, [worker.user.id]);
    expect(inApp).toHaveLength(1);
  });

  it("unverified addresses get no notification emails", async () => {
    const owner = await client({ verified: false });
    const p = await pro();
    // Unverified clients can't post, so create the job directly.
    const job = await createJob(await client());
    await AppDataSource.query(`UPDATE "jobs" SET "homeownerId" = $1 WHERE "id" = $2`, [owner.user.id, job.id]);
    await placeBid(p, job.id);
    await new Promise((r) => setTimeout(r, 50));
    expect(consoleMailer.outbox.some((m) => m.to === owner.user.email)).toBe(false);
  });
});

describe("production configuration guards", () => {
  const base = {
    NODE_ENV: "production",
    JWT_SECRET: "x".repeat(40),
    FILE_URL_SECRET: "y".repeat(40),
    APP_URL: "https://fixlocal.example",
    COOKIE_SECURE: "true",
    MAIL_PROVIDER: "smtp",
    SMTP_URL: "smtps://user:pass@smtp.example.com:465",
  };
  it("accepts a complete production config", () => {
    expect(loadConfig(base)).toMatchObject({ isProd: true, mailProvider: "smtp", cookieSecure: true });
  });
  it("refuses to boot without email delivery, with insecure cookies over HTTPS, or smtp without a URL", () => {
    expect(() => loadConfig({ ...base, MAIL_PROVIDER: "console" })).toThrow(/MAIL_PROVIDER/);
    expect(() => loadConfig({ ...base, MAIL_PROVIDER: "console", ALLOW_CONSOLE_MAIL: "true" })).not.toThrow();
    expect(() => loadConfig({ ...base, COOKIE_SECURE: "false" })).toThrow(/COOKIE_SECURE/);
    expect(() => loadConfig({ ...base, SMTP_URL: "" })).toThrow(/SMTP_URL/);
    expect(() => loadConfig({ ...base, APP_URL: "http://localhost:8080", COOKIE_SECURE: "false" })).not.toThrow();
  });
});

describe("error tracking hook", () => {
  it("reports unexpected errors with the request id, and tells the user the id", async () => {
    const seen: Array<{ err: unknown; ctx: Record<string, unknown> }> = [];
    setErrorReporter((err, ctx) => {
      seen.push({ err, ctx });
    });
    try {
      const json = vi.fn();
      const res = { headersSent: false, status: vi.fn(() => ({ json })) };
      errorHandler(new Error("boom"), { id: "req-123", method: "GET", path: "/x" } as never, res as never, vi.fn());
      expect(res.status).toHaveBeenCalledWith(500);
      expect(json.mock.calls[0][0]).toMatchObject({ code: "INTERNAL", requestId: "req-123" });
      expect(seen).toHaveLength(1);
      expect(seen[0].ctx).toMatchObject({ requestId: "req-123", method: "GET" });
    } finally {
      setErrorReporter(null);
    }
  });
});

describe("payment provider boundary", () => {
  it("every ledger movement carries the provider's reference", async () => {
    const { owner, job } = await awardedJob({ stage: "in_progress" });
    await api().post(`/api/jobs/${job.id}/confirm`).set(owner.auth).expect(200);
    const refs = await rows<{ type: string; providerRef: string }>(
      `SELECT "type", "providerRef" FROM "ledger_entries" WHERE "jobId" = $1`,
      [job.id]
    );
    expect(refs).toHaveLength(6);
    for (const r of refs) expect(r.providerRef).toMatch(new RegExp(`^sim_${r.type}_[0-9a-f]{24}$`));
    expect(new Set(refs.map((r) => r.providerRef)).size).toBe(6);
  });

  it("a provider failure rolls the whole hire back (no escrow, job still open)", async () => {
    const failing: PaymentProvider = { name: "down", live: false, record: async () => { throw new Error("gateway timeout"); } };
    const owner = await client();
    const worker = await pro();
    const job = await createJob(owner);
    const bid = await placeBid(worker, job.id);
    setPaymentProvider(failing);
    try {
      expect((await acceptBid(owner, bid.id)).status).toBe(500);
    } finally {
      setPaymentProvider(new SimulatedPaymentProvider());
    }
    expect((await jobRow(job.id)).status).toBe("open");
    expect(await milestones(job.id)).toHaveLength(0);
    expect((await acceptBid(owner, bid.id)).status).toBe(200);
  });
});
