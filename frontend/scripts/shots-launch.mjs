// Launch-readiness screenshots (desktop 1280 + mobile 390). Usage: API=… WEB=… OUT=… node scripts/shots-launch.mjs
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
  description: "Two ceiling fans hum and wobble; need them balanced and one regulator replaced this weekend.",
  category: "electrical",
  budgetMin: 800,
  budgetMax: 2000,
  area: "Koramangala",
  city: "Bengaluru",
  pincode: "560034",
  lat: 12.9352,
  lng: 77.6245,
});

const client = await login("home@fixlocal.local");
const pro = await login("pro@fixlocal.local");
const pro2 = await login("pro2@fixlocal.local");
for (const u of [client, pro]) await call(u, "post", "/api/auth/accept-terms");

const fixtureFile = `${OUT}/.fixture-launch.json`;
let fx;
if (fs.existsSync(fixtureFile)) fx = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
else {
  // Awarded, not started: completion is locked, booking can be cancelled.
  const { job: awarded } = await call(client, "post", "/api/jobs", jobBody("Balance two ceiling fans"));
  const { bid } = await call(pro, "post", `/api/jobs/${awarded.id}/bids`, { amount: 1500, message: "Saturday 10am works." });
  await call(client, "post", `/api/bids/${bid.id}/accept`, { expectedAmount: 1500, expectedRevision: bid.quoteRevision });
  // A second booking that the pro cancels.
  const { job: called } = await call(client, "post", "/api/jobs", jobBody("Replace fan regulator"));
  const { bid: b2 } = await call(pro, "post", `/api/jobs/${called.id}/bids`, { amount: 900, message: "Can do Sunday." });
  await call(client, "post", `/api/bids/${b2.id}/accept`, { expectedAmount: 900, expectedRevision: b2.quoteRevision });
  await call(pro, "post", `/api/jobs/${called.id}/cancel-booking`, { reason: "Unwell this weekend, sorry." });
  // Something in the blocked list.
  await call(client, "post", "/api/blocks", { userId: pro2.user.id });
  fx = { awarded: awarded.id, called: called.id, proId: pro.user.id };
  fs.writeFileSync(fixtureFile, JSON.stringify(fx));
}

const browser = await chromium.launch();
for (const vp of [
  { name: "desktop", width: 1280, height: 900, mobile: false },
  { name: "mobile", width: 390, height: 844, mobile: true },
]) {
  const ctxFor = () =>
    browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.mobile ? 2 : 1, isMobile: vp.mobile, hasTouch: vp.mobile, acceptDownloads: true });
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
    await page.screenshot({ path: `${OUT}/launch-${name}-${vp.name}.png`, ...opts });
  };
  const scrollTo = (loc) => loc.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90));

  {
    const ctx = await ctxFor();
    const page = await ctx.newPage();
    const shot = shotOf(page);
    await page.goto(`${WEB}/register`);
    const box = page.getByRole("checkbox", { name: /agree to the Terms/ });
    await box.waitFor();
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByText(/Please accept the Terms/).waitFor();
    await shot("register-terms-consent");
    await page.goto(`${WEB}/terms`);
    await page.getByRole("heading", { level: 1, name: "Terms of Service" }).waitFor();
    await shot("terms");
    await page.goto(`${WEB}/privacy`);
    await page.getByRole("heading", { level: 1, name: "Privacy Policy" }).waitFor();
    await shot("privacy");
    await page.goto(`${WEB}/this-page-does-not-exist`);
    await page.getByText("We couldn’t find that page").waitFor();
    await shot("404");
    await ctx.close();
  }
  {
    const { ctx, page } = await signIn("pro2@fixlocal.local");
    const shot = shotOf(page);
    await page.getByRole("region", { name: "Updated terms" }).waitFor();
    await shot("terms-banner-existing-account");
    await ctx.close();
  }
  {
    const { ctx, page } = await signIn("home@fixlocal.local");
    const shot = shotOf(page);
    await page.goto(`${WEB}/client/jobs/${fx.awarded}`);
    await page.getByTestId("awaiting-start").waitFor();
    await page.getByRole("button", { name: "Cancel booking" }).click();
    const form = page.getByRole("heading", { name: "Cancel this booking?" });
    await form.waitFor();
    await scrollTo(page.getByTestId("awaiting-start"));
    await shot("client-awarded-cancel-booking");
    await page.goto(`${WEB}/client/jobs/${fx.called}`);
    await page.getByTestId("cancellation-note").waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot("client-booking-cancelled-by-pro");
    await page.goto(`${WEB}/pros/${fx.proId}`);
    await page.getByRole("button", { name: "Block" }).click();
    await page.getByRole("group", { name: /Block/ }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot("pro-profile-block-confirm");
    await page.goto(`${WEB}/settings`);
    const email = page.getByRole("heading", { name: "Email updates" });
    await email.waitFor();
    await page.getByTestId("blocked-list").waitFor();
    await scrollTo(email);
    await shot("settings-email-blocks-data");
    await ctx.close();
  }
}
await browser.close();
console.log("done", fx);
