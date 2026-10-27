// Round-2 screenshots (desktop 1280 + mobile 390). Usage: API=… WEB=… OUT=… node scripts/shots-round2.mjs
import { chromium, request as pwRequest } from "@playwright/test";
import fs from "node:fs";

const API = process.env.API || "http://localhost:3001";
const WEB = process.env.WEB || "http://localhost:5173";
const OUT = process.env.OUT || "../fixlocal-shots";
const PASSWORD = process.env.SEED_PASSWORD || "Password123!";
fs.mkdirSync(OUT, { recursive: true });

const api = await pwRequest.newContext({ baseURL: API });
async function login(email) {
  const r = await api.post("/api/auth/login", { data: { email, password: PASSWORD } });
  if (!r.ok()) throw new Error(`login ${email}: ${r.status()} ${await r.text()}`);
  const b = await r.json();
  return { token: b.token || b.accessToken, user: b.user };
}
async function call(u, method, path, data) {
  const r = await api.fetch(path, { method, data, headers: { Authorization: `Bearer ${u.token}` } });
  if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
  return r.json();
}
const jobBody = (title) => ({
  title,
  description: "Kitchen tap drips constantly and the cabinet hinge below is loose. Need both sorted this week.",
  category: "plumbing",
  budgetMin: 1200,
  budgetMax: 2500,
  area: "Indiranagar",
  city: "Bengaluru",
  pincode: "560038",
  lat: 12.9719,
  lng: 77.6412,
});

const fixtureFile = `${OUT}/.fixture-r2.json`;
let fx;
if (fs.existsSync(fixtureFile)) fx = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
else {
  const client = await login("home@fixlocal.local");
  const pro = await login("pro@fixlocal.local");
  const pro2 = await login("pro2@fixlocal.local");
  // Completed, not yet reviewed by either side.
  const { job: done } = await call(client, "post", "/api/jobs", jobBody("Fix dripping kitchen tap"));
  const { bid } = await call(pro, "post", `/api/jobs/${done.id}/bids`, { amount: 1400, message: "Can come tomorrow morning." });
  await call(client, "post", `/api/bids/${bid.id}/accept`, { expectedAmount: 1400, expectedRevision: bid.quoteRevision });
  await call(pro, "post", `/api/jobs/${done.id}/start`);
  await call(pro, "post", `/api/jobs/${done.id}/mark-done`);
  await call(client, "post", `/api/jobs/${done.id}/confirm`);
  // Open job where pro2 withdrew their bid.
  const { job: open } = await call(client, "post", "/api/jobs", jobBody("Replace bathroom mixer"));
  const { bid: b2 } = await call(pro2, "post", `/api/jobs/${open.id}/bids`, { amount: 2200, message: "Includes fittings." });
  await call(pro2, "delete", `/api/bids/${b2.id}`);
  fx = { done: done.id, open: open.id };
  fs.writeFileSync(fixtureFile, JSON.stringify(fx));
}

const browser = await chromium.launch();
for (const vp of [
  { name: "desktop", width: 1280, height: 900, mobile: false },
  { name: "mobile", width: 390, height: 844, mobile: true },
]) {
  const ctxFor = () =>
    browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.mobile ? 2 : 1, isMobile: vp.mobile, hasTouch: vp.mobile });
  const signIn = async (email) => {
    const ctx = await ctxFor();
    const page = await ctx.newPage();
    await page.goto(`${WEB}/login`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    return { ctx, page };
  };
  const shotOf = (page) => async (name, opts = {}) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/round2-${name}-${vp.name}.png`, ...opts });
  };

  {
    const { ctx, page } = await signIn("home@fixlocal.local");
    const shot = shotOf(page);
    await page.goto(`${WEB}/client`);
    await page.getByTestId("pending-reviews").waitFor();
    await shot("client-dashboard-review-prompt");
    await page.goto(`${WEB}/client/jobs/${fx.done}#review`);
    await page.getByRole("heading", { name: /How did it go/ }).waitFor();
    await page.waitForTimeout(800);
    await shot("client-completed-job-review");
    await page.goto(`${WEB}/client/jobs/${fx.open}`);
    await page.getByRole("button", { name: "Cancel job" }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot("client-open-job-actions");
    await page.goto(`${WEB}/client/jobs/00000000-0000-4000-8000-000000000000`);
    await page.getByText("We couldn't open this job").waitFor();
    await shot("client-job-load-error");
    await ctx.close();
  }
  {
    const { ctx, page } = await signIn("pro2@fixlocal.local");
    const shot = shotOf(page);
    await page.goto(`${WEB}/professional/jobs/${fx.open}`);
    const form = page.locator("#bid-form");
    await form.waitFor();
    await page.waitForTimeout(800);
    await form.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90));
    await shot("pro-bid-again");
    await ctx.close();
  }
  {
    const { ctx, page } = await signIn("pro@fixlocal.local");
    const shot = shotOf(page);
    await page.goto(`${WEB}/professional`);
    await page.getByTestId("pending-reviews").waitFor();
    await shot("pro-dashboard-review-prompt");
    await ctx.close();
  }
}
await browser.close();
console.log("done", fx);
