import { afterEach, describe, expect, it } from "vitest";
import { AppDataSource } from "../src/data-source";
import { config, overrideConfig } from "../src/config";
import { canonicalEmail, selfReferralReason } from "../src/domain/credits";
import { Notification, NotificationType } from "../src/entities/Notification";
import { Msg91SmsProvider, WhatsAppCloudProvider, logSms, logWhatsApp, setMessagingProvider, toE164 } from "../src/services/messaging";
import { flushOutbound, nextSendTime, queueTexts } from "../src/utils/outbound";
import { PASSWORD, acceptBid, admin, api, awardedJob, client, createJob, placeBid, pro, rows, type TestUser } from "./helpers";

const balance = async (u: TestUser) => (await api().get("/api/credits/me").set(u.auth)).body.credits.balance as number;
// Test users share one phone number, which the self-referral check would (rightly) catch.
const refer = (referred: TestUser, referrer: TestUser) =>
  AppDataSource.query(`UPDATE "users" SET "referredById" = $1, "phone" = NULL WHERE "id" = $2`, [referrer.user.id, referred.user.id]);
const confirm = (job: { id: string }, owner: TestUser) => api().post(`/api/jobs/${job.id}/confirm`).set(owner.auth);

describe("referral credit", () => {
  const original = { ...config().referral };
  afterEach(() => overrideConfig({ referral: { ...original } }));

  it("spots self-referrals by account, job partner, email, phone and device", () => {
    const base = { id: "b", email: "asha.v+fix@gmail.com", phone: "+91 98450 12345", deletedAt: null, isSuspended: false, referredById: "a", signupDeviceHash: "d2" };
    const ref = { id: "a", email: "other@example.com", phone: null, deletedAt: null, isSuspended: false, referredById: null, signupDeviceHash: "d1" };
    expect(canonicalEmail("A.Sha.V+x@GoogleMail.com")).toBe("ashav@gmail.com");
    expect(selfReferralReason(base, ref, "z")).toBeNull();
    expect(selfReferralReason(base, null, "z")).toBe("referrer_inactive");
    expect(selfReferralReason(base, { ...ref, isSuspended: true }, "z")).toBe("referrer_inactive");
    expect(selfReferralReason(base, ref, "a")).toBe("self_dealing");
    expect(selfReferralReason(base, { ...ref, email: "ashav@gmail.com" }, "z")).toBe("same_email");
    expect(selfReferralReason(base, { ...ref, phone: "9845012345" }, "z")).toBe("same_phone");
    expect(selfReferralReason(base, { ...ref, signupDeviceHash: "d2" }, "z")).toBe("same_device");
    expect(selfReferralReason({ ...base, signupDeviceHash: null }, { ...ref, signupDeviceHash: null }, "z")).toBeNull();
  });

  it("pays both sides once when the referred client's first job is confirmed, then uses it at the next hire", async () => {
    const inviter = await pro();
    const { owner, worker, job } = await awardedJob({ stage: "pending_confirmation", amount: 1200 });
    await refer(owner, inviter);
    expect((await confirm(job, owner)).status).toBe(200);
    expect(await balance(owner)).toBe(100);
    expect(await balance(inviter)).toBe(100);
    const notes = await rows<{ title: string }>(`SELECT "title" FROM "notifications" WHERE "userId" = $1 AND "title" = 'You earned FixLocal credit'`, [inviter.user.id]);
    expect(notes).toHaveLength(1);
    expect(await rows(`SELECT 1 FROM "audit_logs" WHERE "action" = 'referral_reward' AND "targetId" = $1`, [job.id])).toHaveLength(1);

    // Second hire: the client's ₹100 comes off what they fund; the payment panel says so.
    const job2 = await createJob(owner);
    const bid2 = await placeBid(worker, job2.id, { amount: 1500 });
    expect((await acceptBid(owner, bid2.id)).status).toBe(200);
    const pay = await api().get(`/api/jobs/${job2.id}/payments`).set(owner.auth);
    expect(pay.body.credit).toEqual({ appliedToPayment: 100, addedToPayout: 0 });
    expect(await balance(owner)).toBe(0);
    // ...and finishing it pays no second reward.
    await api().post(`/api/jobs/${job2.id}/start`).set(worker.auth).expect(200);
    await api().post(`/api/jobs/${job2.id}/mark-done`).set(worker.auth).expect(200);
    await confirm(job2, owner).expect(200);
    expect(await balance(inviter)).toBe(100);
    expect(await rows(`SELECT 1 FROM "referral_rewards" WHERE "referredId" = $1`, [owner.user.id])).toHaveLength(1);

    const credits = (await api().get("/api/credits/me").set(owner.auth)).body.credits;
    expect(credits.entries.map((e: { kind: string; amount: number }) => [e.kind, e.amount])).toEqual([
      ["applied_payment", -100],
      ["referral_reward", 100],
    ]);
    expect((await api().get("/api/credits/me").set((await admin()).auth)).status).toBe(403);
  });

  it("adds a referred professional's credit to their next payout", async () => {
    const inviter = await client();
    const first = await awardedJob({ stage: "pending_confirmation", amount: 800 });
    await refer(first.worker, inviter);
    await confirm(first.job, first.owner).expect(200);
    expect(await balance(first.worker)).toBe(100);
    const c2 = await client();
    const job = await createJob(c2);
    const bid = await placeBid(first.worker, job.id, { amount: 2000 });
    await acceptBid(c2, bid.id);
    const ms = (await api().get(`/api/jobs/${job.id}/payments`).set(c2.auth)).body.milestones;
    const rel = await api().post(`/api/jobs/${job.id}/payments/${ms[0].id}/release`).set(c2.auth);
    expect(rel.status).toBe(200);
    expect(await balance(first.worker)).toBe(0);
    const panel = await api().get(`/api/jobs/${job.id}/payments`).set(first.worker.auth);
    expect(panel.body.credit.addedToPayout).toBe(100);
    const note = await rows<{ body: string }>(`SELECT "body" FROM "notifications" WHERE "userId" = $1 AND "title" = 'Payment released'`, [first.worker.user.id]);
    expect(note[0].body).toContain("₹100 FixLocal credit was added");
  });

  it("blocks self-dealing and small jobs, caps rewards per month and reverses a reward when the dispute is lost", async () => {
    // The inviter hires the person they invited: no reward, but the decision is recorded.
    const sd = await awardedJob({ stage: "pending_confirmation", amount: 1000 });
    await refer(sd.worker, sd.owner);
    await confirm(sd.job, sd.owner).expect(200);
    expect(await balance(sd.worker)).toBe(0);
    expect((await rows<{ status: string; reason: string }>(`SELECT "status", "reason" FROM "referral_rewards" WHERE "referredId" = $1`, [sd.worker.user.id]))[0]).toEqual({ status: "blocked", reason: "self_dealing" });
    expect(await rows(`SELECT 1 FROM "audit_logs" WHERE "action" = 'referral_blocked' AND "targetId" = $1`, [sd.job.id])).toHaveLength(1);

    // Below the minimum job value: nothing yet (a later, bigger job can still qualify).
    const small = await awardedJob({ stage: "pending_confirmation", amount: 300 });
    const inviter = await pro();
    await refer(small.owner, inviter);
    await confirm(small.job, small.owner).expect(200);
    expect(await balance(small.owner)).toBe(0);
    expect(await rows(`SELECT 1 FROM "referral_rewards" WHERE "referredId" = $1`, [small.owner.user.id])).toHaveLength(0);

    // Monthly cap of 1: the second friend still gets theirs, the inviter doesn't.
    overrideConfig({ referral: { ...original, monthlyCap: 1 } });
    const capper = await pro();
    const a = await awardedJob({ stage: "pending_confirmation" });
    const b = await awardedJob({ stage: "pending_confirmation" });
    await refer(a.owner, capper);
    await refer(b.owner, capper);
    await confirm(a.job, a.owner).expect(200);
    await confirm(b.job, b.owner).expect(200);
    expect(await balance(capper)).toBe(100);
    expect(await balance(b.owner)).toBe(100);
    const capped = await api().get("/api/referrals/me").set(capper.auth);
    expect(capped.body.referral.earned).toBe(100);
    expect(capped.body.referral.people.map((p: { rewardAmount: number }) => p.rewardAmount).sort()).toEqual([0, 100]);

    // Dispute on the completed job, decided for the professional's opponent: unused credit goes back.
    const d = await api().post(`/api/jobs/${a.job.id}/disputes`).set(a.owner.auth).field("reason", "Tap still leaks after a day");
    expect(d.status).toBe(201);
    const res = await api().patch(`/api/disputes/${d.body.dispute.id}/resolve`).set((await admin()).auth).send({ resolution: "favor_homeowner" });
    expect(res.status).toBe(200);
    expect(await balance(a.owner)).toBe(0);
    expect(await balance(capper)).toBe(0);
    expect((await rows<{ status: string }>(`SELECT "status" FROM "referral_rewards" WHERE "referredId" = $1`, [a.owner.user.id]))[0].status).toBe("reversed");
    expect(await rows(`SELECT 1 FROM "audit_logs" WHERE "action" = 'referral_reversed' AND "targetId" = $1`, [a.job.id])).toHaveLength(1);
  });

  it("is in the data export and goes with a deleted account", async () => {
    const inviter = await pro();
    const { owner, job } = await awardedJob({ stage: "pending_confirmation" });
    await refer(owner, inviter);
    await confirm(job, owner).expect(200);
    const exp = await api().get("/api/auth/me/export").set(owner.auth);
    expect(exp.body.credits.entries).toHaveLength(1);
    expect(exp.body.referralRewards[0]).toMatchObject({ role: "you_were_invited", status: "granted" });
    expect(JSON.stringify(exp.body)).not.toContain("signupDeviceHash");
    await api().delete("/api/auth/me").set(owner.auth).send({ password: PASSWORD }).expect(200);
    expect(await rows(`SELECT 1 FROM "credit_entries" WHERE "userId" = $1`, [owner.user.id])).toHaveLength(0);
  });

  it("records a sign-up device hash that matches only for the same browser", async () => {
    const reg = (email: string, ua: string) =>
      api().post("/api/auth/register").set("User-Agent", ua).send({ email, password: "Long-Password-123", role: "HOMEOWNER", acceptTerms: true });
    const t = Date.now();
    await reg(`dev-a-${t}@example.com`, "Phone A").expect(202);
    await reg(`dev-b-${t}@example.com`, "Phone A").expect(202);
    await reg(`dev-c-${t}@example.com`, "Laptop C").expect(202);
    const h = await rows<{ email: string; signupDeviceHash: string }>(
      `SELECT "email", "signupDeviceHash" FROM "users" WHERE "email" LIKE $1 ORDER BY "email"`,
      [`dev-%-${t}@example.com`]
    );
    expect(h[0].signupDeviceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(h[0].signupDeviceHash).toBe(h[1].signupDeviceHash);
    expect(h[2].signupDeviceHash).not.toBe(h[0].signupDeviceHash);
  });

  it("can be switched off with REFERRAL_REWARD_INR=0", async () => {
    overrideConfig({ referral: { ...original, rewardInr: 0 } });
    const inviter = await pro();
    const { owner, job } = await awardedJob({ stage: "pending_confirmation" });
    await refer(owner, inviter);
    await confirm(job, owner).expect(200);
    expect(await balance(owner)).toBe(0);
  });
});

describe("SMS / WhatsApp alerts", () => {
  const original = { ...config().messaging };
  const enable = () => overrideConfig({ messaging: { ...original, enabled: true } });
  afterEach(() => {
    overrideConfig({ messaging: { ...original } });
    setMessagingProvider("sms", null);
    setMessagingProvider("whatsapp", null);
  });
  const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
  const codeFor = (to: string) => logSms.outbox.find((m) => m.to === to)?.text.match(/\b(\d{6})\b/)?.[1];
  const settle = async () => {
    for (let i = 0; i < 50; i++) {
      const busy = await rows(`SELECT 1 FROM "outbound_messages" WHERE "status" = 'sending'`);
      if (!busy.length) return;
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  it("normalises Indian numbers and keeps quiet hours from 10 PM to 8 AM IST", () => {
    expect(toE164("98450 12345")).toBe("+919845012345");
    expect(toE164("+91-98450-12345")).toBe("+919845012345");
    expect(toE164("09845012345")).toBe("+919845012345");
    expect(toE164("12345")).toBeNull();
    expect(toE164("+44 7700 900123")).toBe("+447700900123");
    expect(nextSendTime(ist("2026-10-26", "21:59")).toISOString()).toBe(ist("2026-10-26", "21:59").toISOString());
    expect(nextSendTime(ist("2026-10-26", "22:00")).toISOString()).toBe(ist("2026-10-27", "08:00").toISOString());
    expect(nextSendTime(ist("2026-10-27", "03:15")).toISOString()).toBe(ist("2026-10-27", "08:00").toISOString());
    expect(nextSendTime(ist("2026-10-27", "08:00")).toISOString()).toBe(ist("2026-10-27", "08:00").toISOString());
  });

  it("drivers call MSG91 and the WhatsApp Cloud API with a template, and surface errors", async () => {
    const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
    const fake = (reply: unknown, ok = true) => async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return { ok, status: ok ? 200 : 400, json: async () => reply };
    };
    const sms = new Msg91SmsProvider({ authKey: "test-key", templateId: "tmpl-1", senderId: "FXLCL" }, fake({ type: "success", message: "req-9" }));
    expect(await sms.send({ channel: "sms", to: "+919845012345", text: "FixLocal: hi", lang: "en" })).toEqual({ reference: "msg91_req-9" });
    expect(calls[0].url).toBe("https://control.msg91.com/api/v5/flow");
    expect(calls[0].headers.authkey).toBe("test-key");
    expect(calls[0].body).toMatchObject({ template_id: "tmpl-1", sender: "FXLCL", recipients: [{ mobiles: "919845012345", message: "FixLocal: hi" }] });
    await expect(
      new Msg91SmsProvider({ authKey: "k", templateId: "t", senderId: null }, fake({ type: "error", message: "bad template" }, false)).send({
        channel: "sms",
        to: "+919845012345",
        text: "x",
        lang: "en",
      })
    ).rejects.toThrow(/bad template/);

    const wa = new WhatsAppCloudProvider(
      { token: "test-token", phoneNumberId: "555", template: "fixlocal_update", apiVersion: "v21.0" },
      fake({ messages: [{ id: "wamid.1" }] })
    );
    expect(await wa.send({ channel: "whatsapp", to: "+919845012345", text: "FixLocal:\nनई बोली", lang: "hi" })).toEqual({ reference: "wamid.1" });
    expect(calls[2].url).toBe("https://graph.facebook.com/v21.0/555/messages");
    expect(calls[2].headers.authorization).toBe("Bearer test-token");
    expect(calls[2].body).toMatchObject({
      to: "919845012345",
      type: "template",
      template: { name: "fixlocal_update", language: { code: "hi" }, components: [{ type: "body", parameters: [{ type: "text", text: "FixLocal: नई बोली" }] }] },
    });
  });

  it("is off by default: no codes, no opt-ins", async () => {
    const u = await client();
    expect((await api().get("/api/auth/me/messaging").set(u.auth)).body.messaging.enabled).toBe(false);
    expect((await api().post("/api/auth/me/phone/send-code").set(u.auth).send({})).status).toBe(409);
    expect((await api().patch("/api/auth/me").set(u.auth).send({ smsOptIn: true })).status).toBe(409);
  });

  it("verifies a phone with a one-time code, then texts key events on the chosen channels (in Hindi when chosen)", async () => {
    enable();
    const c = await client();
    const p = await pro();
    // Opting in needs a verified phone.
    expect((await api().patch("/api/auth/me").set(c.auth).send({ smsOptIn: true })).body.code).toBe("PHONE_NOT_VERIFIED");
    const phone = `98${String(Date.now()).slice(-8)}`;
    const sent = await api().post("/api/auth/me/phone/send-code").set(c.auth).send({ phone });
    expect(sent.status).toBe(200);
    expect((await api().post("/api/auth/me/phone/send-code").set(c.auth).send({})).status).toBe(429);
    const code = codeFor(`+91${phone}`)!;
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await api().post("/api/auth/me/phone/verify").set(c.auth).send({ code: wrong })).status).toBe(400);
    const ok = await api().post("/api/auth/me/phone/verify").set(c.auth).send({ code });
    expect(ok.status).toBe(200);
    expect(ok.body.user.phoneVerified).toBe(true);
    expect((await api().post("/api/auth/me/phone/verify").set(c.auth).send({ code })).status).toBe(400); // single use
    const me = await api().patch("/api/auth/me").set(c.auth).send({ smsOptIn: true, whatsappOptIn: true, language: "hi" });
    expect(me.body.user).toMatchObject({ smsOptIn: true, whatsappOptIn: true });

    // A first bid is a key event: one row per channel, sent once even with two flushes racing.
    const job = await createJob(c);
    await placeBid(p, job.id, { amount: 1500 });
    const queued = await rows<{ channel: string; body: string }>(`SELECT "channel", "body" FROM "outbound_messages" WHERE "userId" = $1 ORDER BY "channel"`, [c.user.id]);
    expect(queued.map((q) => q.channel)).toEqual(["sms", "whatsapp"]);
    expect(queued[0].body).toMatch(/^FixLocal: आपके काम पर नई बोली http/);
    const later = new Date(Date.now() + 48 * 3600_000);
    await Promise.all([flushOutbound(later), flushOutbound(later)]);
    await settle();
    const done = await rows<{ status: string }>(`SELECT "status" FROM "outbound_messages" WHERE "userId" = $1`, [c.user.id]);
    expect(done.map((d) => d.status)).toEqual(["sent", "sent"]);
    expect(logSms.outbox.filter((m) => m.to === `+91${phone}` && m.text.includes("नई बोली"))).toHaveLength(1);
    expect(logWhatsApp.outbox.filter((m) => m.to === `+91${phone}`)).toHaveLength(1);

    // Changing the number switches texting off until the new one is verified.
    const changed = await api().patch("/api/auth/me").set(c.auth).send({ phone: "9000011111" });
    expect(changed.body.user).toMatchObject({ phoneVerified: false, smsOptIn: false, whatsappOptIn: false });
  });

  it("holds texts during quiet hours, skips users who opted out, and retries failures", async () => {
    enable();
    const u = await client();
    const phone = `97${String(Date.now()).slice(-8)}`;
    await AppDataSource.query(`UPDATE "users" SET "phone" = $1, "phoneVerifiedAt" = now(), "smsOptIn" = true WHERE "id" = $2`, [phone, u.user.id]);
    const notify = async (title: string) =>
      (await AppDataSource.getRepository(Notification).save({ userId: u.user.id, type: NotificationType.SYSTEM, title, body: "b", read: false })) as Notification;
    const night = ist("2026-11-02", "23:10");
    await queueTexts([await notify("Payment released")], AppDataSource.manager, night);
    const [row] = await rows<{ sendAfter: Date }>(`SELECT "sendAfter" FROM "outbound_messages" WHERE "userId" = $1`, [u.user.id]);
    expect(new Date(row.sendAfter).toISOString()).toBe(ist("2026-11-03", "08:00").toISOString());
    expect(await flushOutbound(ist("2026-11-03", "02:00"))).toBe(0);
    expect(await flushOutbound(ist("2026-11-03", "08:01"))).toBe(1);

    // Opted out while queued: skipped at send time.
    await queueTexts([await notify("Bid accepted!")], AppDataSource.manager, night);
    await AppDataSource.query(`UPDATE "users" SET "smsOptIn" = false WHERE "id" = $1`, [u.user.id]);
    await flushOutbound(ist("2026-11-03", "09:00"));
    expect((await rows<{ status: string }>(`SELECT "status" FROM "outbound_messages" WHERE "userId" = $1 AND "body" LIKE '%Bid accepted%'`, [u.user.id]))[0].status).toBe("skipped");

    // Provider down: back in the queue with the error, then failed after 3 attempts.
    await AppDataSource.query(`UPDATE "users" SET "smsOptIn" = true WHERE "id" = $1`, [u.user.id]);
    setMessagingProvider("sms", { name: "down", live: false, send: async () => Promise.reject(new Error("gateway timeout")) });
    await queueTexts([await notify("Job completed")], AppDataSource.manager, night);
    const q = `SELECT "status", "attempts", "lastError" FROM "outbound_messages" WHERE "userId" = $1 AND "body" LIKE '%Job completed%'`;
    await flushOutbound(ist("2026-11-03", "10:00"));
    expect((await rows(q, [u.user.id]))[0]).toMatchObject({ status: "queued", attempts: 1, lastError: "gateway timeout" });
    await flushOutbound(ist("2026-11-04", "10:00"));
    await flushOutbound(ist("2026-11-05", "10:00"));
    expect((await rows(q, [u.user.id]))[0]).toMatchObject({ status: "failed", attempts: 3 });
  });
});
