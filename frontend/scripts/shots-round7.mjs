// Round-7 screenshots (desktop 1280 + mobile 390) against the dev stack.
// Needs the dev API started with DEV_OUTBOX=true RATE_LIMIT_ENABLED=false and workers on (they close the expired job).
// Usage: API=http://localhost:3001 WEB=http://localhost:5173 OUT=/workspace/fixlocal-shots node scripts/shots-round7.mjs
import { chromium, request as pwRequest } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const API = process.env.API || "http://localhost:3001";
const WEB = process.env.WEB || "http://localhost:5173";
const OUT = process.env.OUT || "../fixlocal-shots";
const PASSWORD = process.env.SEED_PASSWORD || "Password123!";
const DEMO_PASSWORD = "Demo-Password-123";
const DB = process.env.DATABASE_URL || "postgres://fixlocal:fixlocal@localhost:5432/fixlocal";
fs.mkdirSync(OUT, { recursive: true });
const sql = (q) => execFileSync("psql", [DB, "-qtAc", q]).toString().trim();

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
async function signUp(name, role) {
  const email = `${name.toLowerCase().replace(/\W+/g, "-")}-${Date.now()}@example.com`;
  await ok(await api.post("/api/auth/register", { data: { email, password: DEMO_PASSWORD, role, name, acceptTerms: true } }), "register");
  const { emails } = await ok(await api.get("/api/dev/outbox"), "outbox");
  const link = emails.find((m) => m.to === email && m.text.includes("/verify-email?token=")).text.match(/https?:\/\/\S+/)[0];
  await ok(await api.post("/api/auth/verify-email", { data: { token: new URL(link).searchParams.get("token") } }), "verify");
  return session(email, DEMO_PASSWORD);
}
const post = (who, title, extra = {}) =>
  call(who, "post", "/api/jobs", {
    title, description: "Water is coming through the kitchen wall and pooling on the floor. Need someone today.", category: "plumbing",
    budgetMin: 800, budgetMax: 4000, address: "4th Cross, HAL 2nd Stage", city: "Bengaluru", area: "Indiranagar", lat: 12.9719, lng: 77.6412, ...extra,
  }).then((r) => r.job);

const pro = await session("pro@fixlocal.local");
const pro2 = await session("pro2@fixlocal.local");
const client = await signUp("Kavya Iyer", "HOMEOWNER");
await call(client, "patch", "/api/auth/me", { businessName: "Iyer Design Studio LLP", gstin: "29AAGCB7383J1Z4" });

// Urgent job with two questions, one answered.
const urgent = await post(client, "Burst pipe behind kitchen wall", { urgent: true });
const q1 = (await call(pro, "post", `/api/jobs/${urgent.id}/questions`, { question: "Is the leak behind tiles, or is the pipe exposed anywhere?" })).question;
await call(client, "put", `/api/jobs/${urgent.id}/questions/${q1.id}/answer`, { answer: "Behind tiles, about a foot above the sink. Main valve is shut." });
await call(pro2, "post", `/api/jobs/${urgent.id}/questions`, { question: "Which floor, and is there a lift for tools?" });

// An open job close to its listing end, and one already closed by the worker.
const ending = await post(client, "Repaint balcony railings");
sql(`UPDATE "jobs" SET "expiresAt" = now() + interval '2 days' WHERE "id" = '${ending.id}'`);
const stale = await post(client, "Fix wobbly ceiling fan");
await call(pro2, "post", `/api/jobs/${stale.id}/bids`, { amount: 900, message: "Can come this weekend." });
sql(`UPDATE "jobs" SET "expiresAt" = now() - interval '1 minute' WHERE "id" = '${stale.id}'`);

// A completed job, reviewed, with the pro's reply; GST on the payment summary.
const done = await post(client, "Replace bathroom mixer tap");
const { bid } = await call(pro, "post", `/api/jobs/${done.id}/bids`, { amount: 2200, message: "Will bring a Jaquar mixer." });
await ok(await api.post(`/api/bids/${bid.id}/accept`, { headers: { ...client.headers, "Idempotency-Key": `shots7-${bid.id}` }, data: { expectedAmount: 2200, expectedRevision: bid.quoteRevision } }), "accept");
await call(pro, "post", `/api/jobs/${done.id}/start`);
await call(pro, "post", `/api/jobs/${done.id}/mark-done`);
await ok(await api.post(`/api/jobs/${done.id}/confirm`, { headers: { ...client.headers, "Idempotency-Key": `shots7-c-${done.id}` } }), "confirm");
const review = (await call(client, "post", "/api/reviews", { jobId: done.id, rating: 4, comment: "Neat work and fair price, but came an hour late." })).review;
await call(pro, "put", `/api/reviews/${review.id}/reply`, { reply: "Thank you, Kavya! Sorry about the delay, I was stuck on Old Airport Road. I'll message ahead next time." });
await call(pro, "patch", "/api/auth/me", { gstin: "27AAPFU0939F1ZV" });

// Wait for the worker to close the stale job (it runs every minute).
for (let i = 0; i < 80 && sql(`SELECT "status" FROM "jobs" WHERE "id" = '${stale.id}'`) !== "cancelled"; i++) await new Promise((r) => setTimeout(r, 1000));
if (sql(`SELECT "status" FROM "jobs" WHERE "id" = '${stale.id}'`) !== "cancelled") throw new Error("worker didn't close the stale job");

const browser = await chromium.launch();
const saved = [];
for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.route(/tile\.openstreetmap\.org/, (route) => route.abort());
  const shot = async (name, locator) => {
    const file = `${OUT}/round7-${name}-${size}.png`;
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

  // 1. Pro: urgent filter, then the Q&A on the job.
  await login("pro@fixlocal.local", PASSWORD);
  await page.goto(`${WEB}/professional`);
  await page.getByRole("button", { name: "Urgent only" }).click();
  await page.getByRole("link", { name: /Burst pipe behind kitchen wall/ }).first().waitFor();
  await shot("urgent-filter");
  await page.goto(`${WEB}/professional/jobs/${urgent.id}`);
  const qa = page.getByRole("region", { name: "Questions about this job" });
  await qa.getByText("Main valve is shut").waitFor();
  await qa.scrollIntoViewIfNeeded();
  await shot("qa-pro", qa);

  // 2. Pro: public reply under a review.
  await page.goto(`${WEB}/pros/${pro.id}`);
  const item = page.getByRole("listitem").filter({ hasText: "came an hour late" }).first();
  await item.getByTestId("review-reply").waitFor();
  await item.scrollIntoViewIfNeeded();
  await shot("review-reply", item);

  // 3. Client: answering questions, listing end, closed job, GST details and payment summary.
  await login(client.email, DEMO_PASSWORD);
  await page.goto(`${WEB}/client/jobs/${urgent.id}`);
  const cqa = page.getByRole("region", { name: "Questions about this job" });
  await cqa.getByText("Which floor").waitFor();
  await cqa.scrollIntoViewIfNeeded();
  await shot("qa-client", cqa);
  await page.goto(`${WEB}/client/jobs/${ending.id}`);
  await page.getByTestId("job-expiry").waitFor();
  await shot("expiry-soon");
  await page.goto(`${WEB}/client/jobs/${stale.id}`);
  await page.getByTestId("cancellation-note").waitFor();
  await page.getByTestId("cancellation-note").scrollIntoViewIfNeeded();
  await shot("job-closed-automatically");
  await page.goto(`${WEB}/settings#business`);
  const biz = page.getByRole("region", { name: "Business & GST details" });
  await biz.getByLabel("GSTIN").waitFor();
  await biz.scrollIntoViewIfNeeded();
  await shot("gst-settings", biz);
  await page.goto(`${WEB}/client`);
  await page.getByText("Burst pipe behind kitchen wall").first().waitFor();
  await shot("urgent-dashboard");
  await ctx.close();
}
await browser.close();
console.log(saved.join("\n"));
