import { afterEach, describe, expect, it } from "vitest";
import { admin, api, awardedJob, client, createJob, png, pro, rows, uniqueEmail } from "./helpers";
import { consoleMailer } from "../src/services/mailer";
import { config, overrideConfig } from "../src/config";
import { logSms, setMessagingProvider } from "../src/services/messaging";
import { VerificationStatus } from "../src/entities/TradespersonProfile";
import request from "supertest";
import { createApp } from "../src/app";

const tokenFromOutbox = (to: string, kind: string) => {
  const mail = consoleMailer.outbox.find((m) => m.to === to && m.text.includes(kind));
  return mail?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
};

describe("auth scan regressions", () => {
  it("F1 pre-account takeover: the confirmed sign-up's password wins, the earlier one stops working", async () => {
    const email = uniqueEmail("victim");
    const attackerPw = "Attacker-Pass-123";
    const victimPw = "Victim-Pass-456!";
    await api().post("/api/auth/register").send({ email, password: attackerPw, role: "HOMEOWNER", acceptTerms: true }).expect(202);
    consoleMailer.outbox.length = 0;
    // Victim signs up later with their own password and confirms from their inbox.
    await api().post("/api/auth/register").send({ email, password: victimPw, role: "HOMEOWNER", acceptTerms: true }).expect(202);
    const token = tokenFromOutbox(email, "verify-email");
    expect(token).toBeTruthy();
    await api().post("/api/auth/verify-email").send({ token }).expect(200);
    const victim = await api().post("/api/auth/login").send({ email, password: victimPw });
    const attacker = await api().post("/api/auth/login").send({ email, password: attackerPw });
    expect(victim.status).toBe(200);
    expect(attacker.status).toBe(401);
  });

  describe("F2 phone verification", () => {
    const original = { ...config().messaging };
    afterEach(() => {
      overrideConfig({ messaging: { ...original } });
      setMessagingProvider("sms", null);
    });
    it("a code sent to number A can't verify number B set afterwards via PATCH /me", async () => {
      overrideConfig({ messaging: { ...original, enabled: true } });
      const u = await client();
      const mine = `98${String(Date.now()).slice(-8)}`;
      const victim = `97${String(Date.now()).slice(-8)}`;
      await api().post("/api/auth/me/phone/send-code").set(u.auth).send({ phone: mine }).expect(200);
      const code = logSms.outbox.find((m) => m.to === `+91${mine}`)?.text.match(/\b(\d{6})\b/)?.[1];
      expect(code).toBeTruthy();
      await api().patch("/api/auth/me").set(u.auth).send({ phone: victim }).expect(200);
      const bad = await api().post("/api/auth/me/phone/verify").set(u.auth).send({ code });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe("CODE_INVALID");
      const opt = await api().patch("/api/auth/me").set(u.auth).send({ smsOptIn: true });
      expect(opt.body.user?.smsOptIn ?? false).toBe(false);
    });
  });

  it("F3 unverified pro can't read open job listings via GET /api/jobs or the alert preview", async () => {
    const owner = await client();
    const res = await api()
      .post("/api/jobs")
      .set(owner.auth)
      .field("title", "Secret photo job")
      .field("description", "Leaking pipe under the sink, see photo")
      .field("category", "plumbing")
      .field("city", "Bengaluru")
      .attach("photos", await png(), "p.png");
    expect(res.status).toBe(201);
    const jobId = res.body.job.id;
    const pending = await pro({ proStatus: VerificationStatus.PENDING });
    const detail = await api().get(`/api/jobs/${jobId}`).set(pending.auth);
    expect(detail.status).toBe(403);
    expect(detail.body.code).toBe("NOT_VERIFIED");
    const list = await api().get("/api/jobs").query({ q: "Secret photo job" }).set(pending.auth);
    expect(list.status).toBe(200);
    expect(list.body.jobs).toEqual([]);
    expect(list.body.verificationRequired).toBe(true);
    const preview = await api().post("/api/job-alerts/preview").set(pending.auth).send({ categories: ["plumbing"] });
    expect(preview.status).toBe(403);
    expect(preview.body.code).toBe("NOT_VERIFIED");
  });

  it("F4 someone else's sign-up attempts can't lock a victim out of reset mail", async () => {
    overrideConfig({ rateLimitEnabled: true, trustProxy: 1 });
    try {
      const app = createApp();
      const victim = await client();
      // Five sign-up attempts for someone else's address from one client (each one mails the victim) ...
      for (let i = 0; i < 6; i++) {
        const r = await request(app)
          .post("/api/auth/register")
          .set("X-Forwarded-For", "203.0.113.5")
          .send({ email: victim.user.email, password: "Whatever-Pass-12", role: "HOMEOWNER", acceptTerms: true });
        expect(r.status).toBe(202);
      }
      // ... and the victim, on their own connection, still gets the reset mail.
      consoleMailer.outbox.length = 0;
      const ok = await request(app).post("/api/auth/forgot-password").set("X-Forwarded-For", "203.0.113.77").send({ email: victim.user.email });
      expect(ok.status).toBe(200);
      expect(tokenFromOutbox(victim.user.email, "reset-password")).toBeTruthy();
    } finally {
      overrideConfig({ rateLimitEnabled: false, trustProxy: 0 });
    }
  });

  it("F5 failed email verifications don't use up the reset / resend buckets", async () => {
    overrideConfig({ rateLimitEnabled: true });
    try {
      // Five bad email-verification attempts by one user from this IP ...
      for (let i = 0; i < 5; i++) {
        const r = await api().post("/api/auth/verify-email").send({ token: `bogus-token-${i}-xxxxxxxx` });
        expect(r.status).toBe(400);
      }
      // ... lock a different signed-in user on the same IP out of resend-verification and password reset.
      const other = await client({ verified: false });
      const r1 = await api().post("/api/auth/resend-verification").set(other.auth).send({});
      expect(r1.status).toBe(200);
      const r2 = await api().post("/api/auth/reset-password").send({ token: "another-bogus-token", password: "Fresh-Pass-1234" });
      expect(r2.status).toBe(400);
    } finally {
      overrideConfig({ rateLimitEnabled: false });
    }
  });

  it("L3 parties see admin notes as from FixLocal support, not an admin's email", async () => {
    const { owner, job } = await awardedJob();
    const a = await admin();
    await api().post("/api/admin/audit-notes").set(a.auth).send({ note: "Checked the photos", targetType: "job", targetId: job.id }).expect(201);
    const res = await api().get(`/api/jobs/${job.id}/payments`).set(owner.auth).expect(200);
    const note = res.body.auditNotes.find((n: { snippet: string }) => n.snippet.includes("Checked the photos"));
    expect(note.actorEmail).toBe("FixLocal support");
    expect(JSON.stringify(res.body)).not.toContain(a.user.email);
  });

  it("L4 reviews on a public profile don't name the reviewer's id or the job", async () => {
    const { owner, worker, job } = await awardedJob({ stage: "completed" });
    await api().post("/api/reviews").set(owner.auth).send({ jobId: job.id, rating: 5, comment: "Great work" }).expect(201);
    const stranger = await client();
    for (const res of [
      await api().get(`/api/profile/user/${worker.user.id}`),
      await api().get(`/api/reviews/pro/${worker.user.id}`).set(stranger.auth),
    ]) {
      expect(res.status).toBe(200);
      expect(res.body.reviews).toHaveLength(1);
      expect(res.body.reviews[0].rating).toBe(5);
      expect(res.body.reviews[0].reviewerId).toBeUndefined();
      expect(res.body.reviews[0].jobTitle).toBeUndefined();
    }
    const own = await api().get(`/api/reviews/pro/${worker.user.id}`).set(worker.auth).expect(200);
    expect(own.body.reviews[0].jobTitle).toBe(job.title);
  });

  it("L5 file downloads ignore a token whose role no longer matches the account", async () => {
    const owner = await client();
    const created = await api()
      .post("/api/jobs")
      .set(owner.auth)
      .field("title", "Photo job for L5")
      .field("description", "Leaking pipe under the sink, see photo")
      .field("category", "plumbing")
      .field("city", "Bengaluru")
      .attach("photos", await png(), "p.png")
      .expect(201);
    const url = String(created.body.job.photoUrls[0]).split("?")[0];
    expect((await api().get(url)).status).toBe(401);
    expect((await api().get(url).set(owner.auth)).status).toBe(200);
    await rows(`UPDATE "users" SET "role" = 'TRADESPERSON' WHERE "id" = $1`, [owner.user.id]);
    const { invalidateAuthState } = await import("../src/auth/authState");
    await invalidateAuthState(owner.user.id);
    expect((await api().get(url).set(owner.auth)).status).toBe(401);
  });

  it("removing a case study deletes its own photos but keeps gallery photos", async () => {
    const { owner, worker, job } = await awardedJob({ stage: "in_progress" });
    await api().post(`/api/jobs/${job.id}/completion-photos`).set(worker.auth).attach("after", await png(), { filename: "a.png", contentType: "image/png" }).expect(200);
    await api().post(`/api/jobs/${job.id}/mark-done`).set(worker.auth).expect(200);
    await api().post(`/api/jobs/${job.id}/confirm`).set(owner.auth).expect(200);
    await api().post(`/api/jobs/${job.id}/photo-consent`).set(owner.auth).send({ consent: true }).expect(200);
    const pub = await api().post(`/api/jobs/${job.id}/publish-case-study`).set(worker.auth).send({ title: "Sink fixed" }).expect(200);
    const url = pub.body.caseStudy.afterUrl as string;
    expect((await api().get(url)).status).toBe(200);
    await api().patch("/api/profile").set(worker.auth).send({ caseStudies: [] }).expect(200);
    expect((await api().get(url)).status).toBe(404);
  });

  it("admin matching settings reject bad numbers and unknown presets", async () => {
    const a = await admin();
    for (const body of [{ skills: "lots" }, { weights: { rating: 500 } }, { preset: "bogus" }, { heatWeight: 99 }, { bestValueBlend: { matchPct: -1 } }]) {
      const res = await api().put("/api/admin/match-weights").set(a.auth).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await api().get("/api/admin/best-value-blend/preview?matchPct=abc").set(a.auth)).status).toBe(400);
    expect((await api().get("/api/admin/best-value-blend/preview?matchPct=60&pricePct=40").set(a.auth)).status).toBe(200);
  });
});
