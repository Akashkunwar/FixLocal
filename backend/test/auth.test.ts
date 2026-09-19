import { describe, expect, it } from "vitest";
import request from "supertest";
import { admin, api, app, client, createJob, PASSWORD, pro, rows, uniqueEmail } from "./helpers";
import { consoleMailer } from "../src/services/mailer";
import { overrideConfig, config } from "../src/config";

const cookieOf = (res: request.Response) => {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  return (raw || []).find((c) => c.startsWith("fl_refresh="));
};
const tokenFromOutbox = (to: string, kind: "verify-email" | "reset-password") => {
  const mail = consoleMailer.outbox.find((m) => m.to === to && m.text.includes(kind));
  const match = mail?.text.match(/token=([A-Za-z0-9_-]+)/);
  return match?.[1];
};

describe("registration and login", () => {
  it("registers with a normalized email, sets a refresh cookie, and sends a verification email", async () => {
    const email = uniqueEmail("Reg").toUpperCase();
    const res = await api()
      .post("/api/auth/register")
      .send({ email: `  ${email} `, password: "Long-enough-pass-9", role: "HOMEOWNER", name: "Asha" });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(email.toLowerCase());
    expect(res.body.user.emailVerified).toBe(false);
    expect(res.body.token).toBeTruthy();
    const cookie = cookieOf(res)!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(tokenFromOutbox(email.toLowerCase(), "verify-email")).toBeTruthy();
  });

  it("rejects bad registration input (H-10)", async () => {
    const cases = [
      { email: "not-an-email", password: "Long-enough-pass-9", role: "HOMEOWNER" },
      { email: uniqueEmail(), password: "short", role: "HOMEOWNER" },
      { email: uniqueEmail(), password: "password123", role: "HOMEOWNER" },
      { email: uniqueEmail(), password: "Long-enough-pass-9", role: "ADMIN" },
      { email: uniqueEmail(), password: "Long-enough-pass-9", role: "HOMEOWNER", phone: "<script>" },
    ];
    for (const body of cases) {
      const res = await api().post("/api/auth/register").send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("treats an email that differs only by case/whitespace as taken", async () => {
    const email = uniqueEmail("dupe");
    await api().post("/api/auth/register").send({ email, password: "Long-enough-pass-9", role: "HOMEOWNER" }).expect(201);
    const res = await api()
      .post("/api/auth/register")
      .send({ email: ` ${email.toUpperCase()} `, password: "Long-enough-pass-9", role: "HOMEOWNER" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EMAIL_TAKEN");
  });

  it("logs in, and gives the same answer for unknown email and wrong password", async () => {
    const c = await client();
    const ok = await api().post("/api/auth/login").send({ email: c.user.email, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe(c.user.id);
    const wrong = await api().post("/api/auth/login").send({ email: c.user.email, password: "nope-nope-nope" });
    const unknown = await api().post("/api/auth/login").send({ email: uniqueEmail("ghost"), password: "nope-nope-nope" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("blocks suspended users at login", async () => {
    const c = await client({ suspended: true });
    const res = await api().post("/api/auth/login").send({ email: c.user.email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_SUSPENDED");
  });
});

describe("sessions (H-3)", () => {
  it("rotates refresh tokens and revokes the family when an old one is reused", async () => {
    const c = await client();
    const login = await api().post("/api/auth/login").send({ email: c.user.email, password: PASSWORD });
    const first = cookieOf(login)!.split(";")[0];
    const r1 = await api().post("/api/auth/refresh").set("Cookie", first);
    expect(r1.status).toBe(200);
    expect(r1.body.token).toBeTruthy();
    const second = cookieOf(r1)!.split(";")[0];
    expect(second).not.toBe(first);

    const reuse = await api().post("/api/auth/refresh").set("Cookie", first);
    expect(reuse.status).toBe(401);
    // The legitimate newer token is now revoked too.
    const after = await api().post("/api/auth/refresh").set("Cookie", second);
    expect(after.status).toBe(401);
  });

  it("logout revokes the refresh token", async () => {
    const c = await client();
    const login = await api().post("/api/auth/login").send({ email: c.user.email, password: PASSWORD });
    const cookie = cookieOf(login)!.split(";")[0];
    await api().post("/api/auth/logout").set("Cookie", cookie).expect(200);
    expect((await api().post("/api/auth/refresh").set("Cookie", cookie)).status).toBe(401);
  });

  it("an expired access token is rejected while refresh still works", async () => {
    const c = await client();
    const login = await api().post("/api/auth/login").send({ email: c.user.email, password: PASSWORD });
    const cookie = cookieOf(login)!.split(";")[0];
    const original = config().accessTokenTtlSec;
    overrideConfig({ accessTokenTtlSec: 1 });
    try {
      const refreshed = await api().post("/api/auth/refresh").set("Cookie", cookie);
      const short = refreshed.body.token as string;
      await new Promise((r) => setTimeout(r, 2100));
      const expired = await api().get("/api/auth/me").set("Authorization", `Bearer ${short}`);
      expect(expired.status).toBe(401);
      expect(expired.body.code).toBe("TOKEN_EXPIRED");
      const again = await api().post("/api/auth/refresh").set("Cookie", cookieOf(refreshed)!.split(";")[0]);
      expect(again.status).toBe(200);
    } finally {
      overrideConfig({ accessTokenTtlSec: original });
    }
  });

  it("a suspended user's existing token stops working immediately", async () => {
    const a = await admin();
    const c = await client();
    await api().get("/api/jobs").set(c.auth).expect(200);
    await api().patch(`/api/admin/users/${c.user.id}/suspend`).set(a.auth).send({ suspended: true }).expect(200);
    const blocked = await api().post("/api/jobs").set(c.auth).send({ title: "t", description: "d", category: "other" });
    expect([401, 403]).toContain(blocked.status);
    expect((await api().get("/api/auth/me").set(c.auth)).status).not.toBe(200);
  });

  it("changing the password invalidates other sessions", async () => {
    const c = await client();
    const res = await api()
      .post("/api/auth/change-password")
      .set(c.auth)
      .send({ currentPassword: PASSWORD, newPassword: "Brand-new-pass-77" });
    expect(res.status).toBe(200);
    expect((await api().get("/api/auth/me").set(c.auth)).body.code).toBe("TOKEN_REVOKED");
    expect((await api().get("/api/auth/me").set("Authorization", `Bearer ${res.body.token}`)).status).toBe(200);
    const wrong = await api()
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${res.body.token}`)
      .send({ currentPassword: "not-it-at-all", newPassword: "Another-pass-88" });
    expect(wrong.status).toBe(400);
  });

  it("does not accept access tokens in the query string", async () => {
    const a = await admin();
    const res = await api().get(`/api/admin/stats?token=${a.token}`);
    expect(res.status).toBe(401);
  });

  it("SSE tickets work exactly once", async () => {
    const c = await client();
    const t = await api().post("/api/auth/sse-ticket").set(c.auth);
    expect(t.status).toBe(200);
    const server = app().listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      const url = `http://127.0.0.1:${port}/api/notifications/stream?ticket=${t.body.ticket}`;
      const ctrl = new AbortController();
      const first = await fetch(url, { signal: ctrl.signal });
      expect(first.status).toBe(200);
      expect(first.headers.get("content-type")).toContain("text/event-stream");
      ctrl.abort();
      const second = await fetch(url);
      expect(second.status).toBe(401);
      const bogus = await fetch(`http://127.0.0.1:${port}/api/notifications/stream?ticket=nope`);
      expect(bogus.status).toBe(401);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});

describe("email verification and password reset", () => {
  it("unverified clients can't post jobs until they verify", async () => {
    const email = uniqueEmail("verify");
    const reg = await api().post("/api/auth/register").send({ email, password: "Long-enough-pass-9", role: "HOMEOWNER" });
    const auth = { Authorization: `Bearer ${reg.body.token}` };
    const blocked = await api().post("/api/jobs").set(auth).send({ title: "t", description: "d", category: "other" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("EMAIL_NOT_VERIFIED");

    const token = tokenFromOutbox(email, "verify-email")!;
    await api().post("/api/auth/verify-email").send({ token }).expect(200);
    expect((await api().post("/api/auth/verify-email").send({ token })).status).toBe(400);
    const allowed = await api().post("/api/jobs").set(auth).send({ title: "Paint", description: "One wall", category: "painting" });
    expect(allowed.status).toBe(201);
  });

  it("unverified pros can't bid", async () => {
    const owner = await client();
    const job = await createJob(owner);
    const p = await pro({ verified: false });
    const res = await api().post(`/api/jobs/${job.id}/bids`).set(p.auth).send({ amount: 100 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("resets a password with a one-time link and revokes sessions", async () => {
    const c = await client();
    const unknown = await api().post("/api/auth/forgot-password").send({ email: uniqueEmail("nobody") });
    const known = await api().post("/api/auth/forgot-password").send({ email: c.user.email });
    expect(unknown.body).toEqual(known.body);
    const token = tokenFromOutbox(c.user.email, "reset-password")!;
    expect(token).toBeTruthy();
    await api().post("/api/auth/reset-password").send({ token, password: "Reset-pass-2026" }).expect(200);
    expect((await api().post("/api/auth/reset-password").send({ token, password: "Reset-pass-2027" })).status).toBe(400);
    expect((await api().get("/api/auth/me").set(c.auth)).status).toBe(401);
    expect((await api().post("/api/auth/login").send({ email: c.user.email, password: "Reset-pass-2026" })).status).toBe(200);
    expect((await api().post("/api/auth/login").send({ email: c.user.email, password: PASSWORD })).status).toBe(401);
  });
});

describe("profile settings", () => {
  it("persists every notification toggle, including match and pro_available (M-2)", async () => {
    const c = await client();
    const res = await api()
      .patch("/api/auth/me")
      .set(c.auth)
      .send({ notificationPrefs: { match: false, pro_available: false, constructor: false, __proto__: { x: 1 }, bogus: false } });
    expect(res.status).toBe(200);
    expect(res.body.user.notificationPrefs.match).toBe(false);
    expect(res.body.user.notificationPrefs.pro_available).toBe(false);
    expect(res.body.user.notificationPrefs.new_bid).toBe(true);
    expect(res.body.user.notificationPrefs).not.toHaveProperty("constructor");
    expect(res.body.user.notificationPrefs).not.toHaveProperty("bogus");
    const me = await api().get("/api/auth/me").set(c.auth);
    expect(me.body.user.notificationPrefs.match).toBe(false);
  });

  it("validates nudge hours and time zone", async () => {
    const c = await client();
    expect((await api().patch("/api/auth/me").set(c.auth).send({ quoteViewNudgeHours: 500 })).status).toBe(400);
    expect((await api().patch("/api/auth/me").set(c.auth).send({ timezone: "Mars/Olympus" })).status).toBe(400);
    const ok = await api().patch("/api/auth/me").set(c.auth).send({ quoteViewNudgeHours: 12, timezone: "Europe/London" });
    expect(ok.body.user.quoteViewNudgeHours).toBe(12);
    expect(ok.body.user.timezone).toBe("Europe/London");
    const cleared = await api().patch("/api/auth/me").set(c.auth).send({ quoteViewNudgeHours: null });
    expect(cleared.body.user.quoteViewNudgeHours).toBeNull();
  });

  it("stores templates per kind and keeps them off /me (L-7)", async () => {
    const c = await client();
    const put = await api()
      .put("/api/auth/me/templates/invite")
      .set(c.auth)
      .send({ items: [{ id: "a", label: "Hello", body: "Please bid" }, { label: "Empty", body: "   " }] });
    expect(put.status).toBe(200);
    expect(put.body.items).toHaveLength(1);
    await api()
      .put("/api/auth/me/templates/namedJob")
      .set(c.auth)
      .send({
        items: [
          { name: "Monthly clean", title: "Deep clean", category: "cleaning", siteType: "office", pinned: true, junk: 1 },
          { name: "Other", title: "Gutter", pinned: "yes" },
        ],
      })
      .expect(200);
    const list = await api().get("/api/auth/me/templates").set(c.auth);
    expect(list.body.templates.invite[0]).toMatchObject({ id: "a", label: "Hello", body: "Please bid" });
    expect(list.body.templates.namedJob[0]).toMatchObject({ name: "Monthly clean", siteType: "office", pinned: true });
    expect(list.body.templates.namedJob[0]).not.toHaveProperty("junk");
    expect(list.body.templates.namedJob[1]).not.toHaveProperty("pinned");
    expect((await api().put("/api/auth/me/templates/bogus").set(c.auth).send({ items: [] })).status).toBe(400);
    const me = await api().get("/api/auth/me").set(c.auth);
    expect(me.body.user).not.toHaveProperty("inviteTemplates");
  });

  it("deletes an account by anonymizing it", async () => {
    const c = await client();
    await createJob(c);
    expect((await api().delete("/api/auth/me").set(c.auth).send({ password: "wrong-password" })).status).toBe(400);
    const res = await api().delete("/api/auth/me").set(c.auth).send({ password: PASSWORD });
    expect(res.status).toBe(200);
    const [row] = await rows<{ email: string; name: string; phone: string | null; deletedAt: Date }>(
      `SELECT "email", "name", "phone", "deletedAt" FROM "users" WHERE "id" = $1`,
      [c.user.id]
    );
    expect(row.email).toContain("deleted");
    expect(row.phone).toBeNull();
    expect(row.deletedAt).toBeTruthy();
    const [job] = await rows<{ status: string }>(`SELECT "status" FROM "jobs" WHERE "homeownerId" = $1`, [c.user.id]);
    expect(job.status).toBe("cancelled");
    expect((await api().get("/api/auth/me").set(c.auth)).status).toBe(401);
    expect((await api().post("/api/auth/login").send({ email: c.user.email, password: PASSWORD })).status).toBe(401);
  });

  it("removes a deleted professional's profile files", async () => {
    const { png, pdf, pro, uploadedFileCount } = await import("./helpers");
    const p = await pro();
    const before = await uploadedFileCount();
    const gallery = await api().post("/api/profile/gallery").set(p.auth).attach("photos", await png(), { filename: "g.png", contentType: "image/png" });
    expect(gallery.status).toBe(200);
    const lic = await api().post("/api/profile/license").set(p.auth).attach("file", pdf(), { filename: "id.pdf", contentType: "application/pdf" });
    expect(lic.status).toBe(200);
    expect(await uploadedFileCount()).toBe(before + 2);
    expect((await api().delete("/api/auth/me").set(p.auth).send({ password: PASSWORD })).status).toBe(200);
    expect(await uploadedFileCount()).toBe(before);
    expect(await rows(`SELECT 1 FROM "uploads" WHERE "ownerUserId" = $1`, [p.user.id])).toHaveLength(0);
    const [profile] = await rows<{ galleryUrls: string[]; licenseDocUrl: string | null }>(
      `SELECT "galleryUrls", "licenseDocUrl" FROM "tradesperson_profiles" WHERE "userId" = $1`,
      [p.user.id]
    );
    expect(profile).toEqual({ galleryUrls: [], licenseDocUrl: null });
  });

  it("refuses deletion while a job is in progress", async () => {
    const { awardedJob } = await import("./helpers");
    const { owner } = await awardedJob();
    const res = await api().delete("/api/auth/me").set(owner.auth).send({ password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ACTIVE_JOBS");
  });
});
