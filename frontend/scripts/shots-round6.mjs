// Round-6 screenshots (desktop 1280 + mobile 390) against the dev stack.
// Needs the dev API started with MESSAGING_ENABLED=true DEV_OUTBOX=true RATE_LIMIT_ENABLED=false.
// Usage: API=http://localhost:3001 WEB=http://localhost:5173 OUT=/workspace/fixlocal-shots node scripts/shots-round6.mjs
import { chromium, request as pwRequest } from "@playwright/test";
import fs from "node:fs";

const API = process.env.API || "http://localhost:3001";
const WEB = process.env.WEB || "http://localhost:5173";
const OUT = process.env.OUT || "../fixlocal-shots";
const PASSWORD = process.env.SEED_PASSWORD || "Password123!";
const DEMO_PASSWORD = "Demo-Password-123";
fs.mkdirSync(OUT, { recursive: true });

const api = await pwRequest.newContext({ baseURL: API });
const ok = async (res, what) => {
  if (!res.ok()) throw new Error(`${what}: ${res.status()} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
};
async function session(email, password = PASSWORD) {
  const body = await ok(await api.post("/api/auth/login", { data: { email, password } }), `login ${email}`);
  return { id: body.user.id, email, headers: { Authorization: `Bearer ${body.token}` } };
}
const call = (who, method, url, data) => api[method](url, { headers: who.headers, data }).then((r) => ok(r, `${method} ${url}`));
async function signUp(name, role, ua, referralCode) {
  const email = `${name.toLowerCase().replace(/\W+/g, "-")}-${Date.now()}@example.com`;
  await ok(await api.post("/api/auth/register", { headers: { "User-Agent": ua }, data: { email, password: DEMO_PASSWORD, role, name, acceptTerms: true, referralCode } }), "register");
  const { emails } = await ok(await api.get("/api/dev/outbox"), "outbox");
  const link = emails.find((m) => m.to === email && m.text.includes("/verify-email?token=")).text.match(/https?:\/\/\S+/)[0];
  await ok(await api.post("/api/auth/verify-email", { data: { token: new URL(link).searchParams.get("token") } }), "verify");
  return session(email, DEMO_PASSWORD);
}

// Referral credit: a new client invites a friend; the friend's first job completes, both get ₹100.
const pro = await session("pro@fixlocal.local");
const inviter = await signUp("Anita Rao", "HOMEOWNER", "Anita's phone");
const code = (await call(inviter, "post", "/api/referrals/me/code")).referral.code;
const friend = await signUp("Meera Shah", "HOMEOWNER", "Meera's laptop", code);
const post = (who, title, amount) =>
  call(who, "post", "/api/jobs", {
    title, description: "The kitchen tap drips all night and the washer needs replacing.", category: "plumbing",
    budgetMin: 500, budgetMax: 4000, address: "12 MG Road", city: "Bengaluru", area: "Indiranagar", lat: 12.9719, lng: 77.6412,
  }).then((r) => ({ ...r.job, amount }));
async function hire(client, job) {
  const { bid } = await call(pro, "post", `/api/jobs/${job.id}/bids`, { amount: job.amount, message: "Can come tomorrow morning with spare washers." });
  const r = await api.post(`/api/bids/${bid.id}/accept`, {
    headers: { ...client.headers, "Idempotency-Key": `shots-${bid.id}` },
    data: { expectedAmount: job.amount, expectedRevision: bid.quoteRevision },
  });
  await ok(r, "accept");
}
const fjob = await post(friend, "Fix leaking kitchen tap", 1500);
await hire(friend, fjob);
await call(pro, "post", `/api/jobs/${fjob.id}/start`);
await call(pro, "post", `/api/jobs/${fjob.id}/mark-done`);
await call(friend, "post", `/api/jobs/${fjob.id}/confirm`);
// The inviter's next hire uses the credit; this job is also shown in Hindi.
const ijob = await post(inviter, "Bathroom geyser not heating", 2400);
await hire(inviter, ijob);

// Job alerts for the pro: one daily, one instant.
const { alerts } = await call(pro, "get", "/api/job-alerts");
for (const a of alerts.filter((x) => x.name?.startsWith("Round 6"))) await call(pro, "delete", `/api/job-alerts/${a.id}`);
await call(pro, "post", "/api/job-alerts", { name: "Round 6 · plumbing digest", categories: ["plumbing"], city: "Bengaluru", frequency: "daily" });
await call(pro, "post", "/api/job-alerts", { name: "Round 6 · urgent electrical", categories: ["electrical"], city: "Bengaluru", frequency: "instant" });

const browser = await chromium.launch();
const saved = [];
for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.route(/tile\.openstreetmap\.org/, (route) => route.abort());
  const shot = async (name, locator) => {
    const file = `${OUT}/round6-${name}-${size}.png`;
    await page.waitForTimeout(700);
    if (locator) await locator.screenshot({ path: file });
    else await page.screenshot({ path: file, fullPage: false });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    if (wide) throw new Error(`${name} (${size}) scrolls sideways`);
    saved.push(file);
  };
  const login = async (email, password) => {
    await ctx.clearCookies();
    await page.goto(`${WEB}/login`);
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${WEB}/login`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  };

  // 1. Referral credit (inviter): credit card + invite card.
  await call(inviter, "patch", "/api/auth/me", { language: "en" });
  await login(inviter.email, DEMO_PASSWORD);
  await page.goto(`${WEB}/settings#credit`);
  const credit = page.getByRole("region", { name: "FixLocal credit" });
  await credit.getByText("Referral reward").first().waitFor();
  await credit.scrollIntoViewIfNeeded();
  await shot("referral-credit", credit);
  await shot("invite-earned", page.locator("section[aria-labelledby=invite-title]"));
  await page.goto(`${WEB}/client/jobs/${ijob.id}`);
  await page.getByText("FixLocal credit used").first().waitFor();
  await page.getByText("FixLocal credit used").first().scrollIntoViewIfNeeded();
  await shot("credit-used-at-hire");

  // 2. Text alerts settings (SMS / WhatsApp), verified with the dev outbox code (a fresh pro each size:
  //    codes can only be re-sent once a minute).
  const texter = await signUp(`Ramesh Kumar ${size}`, "TRADESPERSON", `Ramesh ${size}`);
  await login(texter.email, DEMO_PASSWORD);
  await page.goto(`${WEB}/settings`);
  const texts = page.getByRole("region", { name: "Text alerts (SMS / WhatsApp)" });
  await texts.getByRole("checkbox", { name: "SMS" }).waitFor();
  await texts.scrollIntoViewIfNeeded();
  const phone = `98${String(Date.now()).slice(-8)}`;
  await texts.getByLabel("Mobile number").fill(phone);
  await texts.getByRole("button", { name: "Send code" }).click();
  await texts.getByLabel("6-digit code").waitFor({ timeout: 8000 }).catch(async (e) => {
    await page.screenshot({ path: "/tmp/shots-debug.png", fullPage: false });
    throw e;
  });
  await shot("text-alerts-code", texts);
  const outbox = await ok(await api.get("/api/dev/outbox"), "outbox");
  const otp = outbox.texts.find((m) => m.to === `+91${phone}`).text.match(/\b(\d{6})\b/)[1];
  await texts.getByLabel("6-digit code").fill(otp);
  await texts.getByRole("button", { name: "Verify" }).click();
  await texts.getByText("Number verified.").waitFor();
  await texts.getByRole("checkbox", { name: "WhatsApp" }).check();
  await texts.getByText("Saved.").waitFor();
  await shot("text-alerts-on", texts);

  // 3. Hindi: dashboard and job page (language saved on the account).
  await login(inviter.email, DEMO_PASSWORD);
  await page.goto(`${WEB}/client`);
  await page.getByRole("button", { name: /View in Hindi/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "मेरे काम" }).waitFor();
  await shot("hindi-dashboard");
  await page.goto(`${WEB}/client/jobs/${ijob.id}`);
  await page.getByText("काम का सार").first().waitFor();
  await shot("hindi-job-page");
  await page.getByText("नकली एस्क्रो").first().scrollIntoViewIfNeeded();
  await shot("hindi-job-payments");
  await page.goto(`${WEB}/terms`);
  await page.getByText("यह कानूनी पाठ सिर्फ़ अंग्रेज़ी में है।").waitFor();
  await shot("hindi-terms");
  await call(inviter, "patch", "/api/auth/me", { language: "en" });

  // 4. Job alert frequency (pro).
  await login("pro@fixlocal.local", PASSWORD);
  await page.goto(`${WEB}/professional/alerts`);
  await page.getByRole("radio", { name: /Daily digest/ }).waitFor();
  await shot("alert-frequency-form", page.getByRole("radiogroup").or(page.locator("fieldset").filter({ hasText: "How often" })).first());
  const list = page.getByRole("listitem").filter({ hasText: "Round 6 · plumbing digest" });
  await list.scrollIntoViewIfNeeded();
  await shot("alert-frequency-list");
  await ctx.close();
}
await browser.close();
console.log(saved.join("\n"));
