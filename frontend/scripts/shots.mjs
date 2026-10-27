// Headless screenshots of the main client screens (desktop 1280 + mobile 390).
// Usage: API=http://localhost:3001 WEB=http://localhost:5173 OUT=/path PREFIX=after node scripts/shots.mjs
import { chromium, request as pwRequest } from "@playwright/test";
import fs from "node:fs";

const API = process.env.API || "http://localhost:3001";
const WEB = process.env.WEB || "http://localhost:5173";
const OUT = process.env.OUT || "../fixlocal-shots";
const PREFIX = process.env.PREFIX || "after";
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

// Fixture: one open job with three competing bids, one awarded job, one awaiting confirmation.
let fixture;
const fixtureFile = `${OUT}/.fixture.json`;
if (fs.existsSync(fixtureFile)) fixture = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
else {
  const client = await login("home@fixlocal.local");
  const pro = await login("pro@fixlocal.local");
  const pro2 = await login("pro2@fixlocal.local");
  const jobBody = (title) => ({
    title,
    description: "Water pools under the bathroom sink and the flush keeps running. Need it fixed this week.",
    category: "plumbing",
    budgetMin: 1500,
    budgetMax: 3000,
    area: "Indiranagar",
    city: "Bengaluru",
    address: "12 MG Road",
    pincode: "560038",
    lat: 12.9719,
    lng: 77.6412,
  });
  const open = (await call(client, "post", "/api/jobs", jobBody("Bathroom leak and running flush"))).job;
  await call(pro, "post", `/api/jobs/${open.id}/bids`, {
    amount: 2400, quoteAmount: 2400, quoteNotes: "Replace washer + flush valve, parts included", etaDays: 2,
    message: "I can come tomorrow morning. I carry common spares, so most fixes are done in one visit.",
    proposedVisitStart: new Date(Date.now() + 86400000).toISOString(),
  });
  await call(pro2, "post", `/api/jobs/${open.id}/bids`, {
    amount: 1900, etaDays: 4, message: "Can do it on the weekend. Price is labour only; parts at cost.",
  });
  const awarded = (await call(client, "post", "/api/jobs", jobBody("Kitchen tap replacement"))).job;
  const ab = (await call(pro, "post", `/api/jobs/${awarded.id}/bids`, { amount: 3000, etaDays: 1 })).bid;
  await call(client, "post", `/api/bids/${ab.id}/accept`, { expectedAmount: 3000, expectedRevision: ab.quoteRevision ?? 0 });
  fixture = { open: open.id, awarded: awarded.id };
  fs.writeFileSync(fixtureFile, JSON.stringify(fixture));
}

// Release the deposit on the awarded job so the escrow panel shows the next milestone's lock reason.
{
  const client = await login("home@fixlocal.local");
  const pay = await call(client, "get", `/api/jobs/${fixture.awarded}/payments`);
  const deposit = pay.milestones.find((m) => m.sequence === 1);
  if (deposit && deposit.status === "held") await call(client, "post", `/api/jobs/${fixture.awarded}/payments/${deposit.id}/release`);
}

const browser = await chromium.launch();
for (const vp of [
  { name: "desktop", width: 1280, height: 900, mobile: false },
  { name: "mobile", width: 390, height: 844, mobile: true },
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.mobile ? 2 : 1, isMobile: vp.mobile, hasTouch: vp.mobile });
  const page = await ctx.newPage();
  await page.goto(`${WEB}/login`);
  await page.getByLabel("Email").fill("home@fixlocal.local");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));

  const shot = async (name, opts = {}) => {
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${PREFIX}-${name}-${vp.name}.png`, ...opts });
  };

  await page.goto(`${WEB}/client/jobs/${fixture.open}`);
  await page.locator('li[id^="bid-"]').first().waitFor();
  await page.waitForTimeout(1500); // let late panels (suggested pros, shortlist) settle before scrolling
  // Section crops come from a full-page capture, where the fixed mobile nav would float mid-image.
  const hideFixedNav = () =>
    page.addStyleTag({ content: 'nav[aria-label="Mobile primary"]{display:none!important}' });
  const clipAt = async (locator) => {
    await hideFixedNav();
    const box = await locator.boundingBox();
    const y = Math.max(0, (box?.y ?? 0) + (await page.evaluate(() => window.scrollY)) - 24);
    return { fullPage: true, clip: { x: 0, y, width: vp.width, height: vp.height } };
  };
  await shot("bid-compare", await clipAt(page.locator("h2", { hasText: /^Bids \(/ }).first()));
  await shot("job-detail-full", { fullPage: true });

  await page.goto(`${WEB}/client/jobs/${fixture.awarded}`);
  const esc = page.getByText("Simulated escrow").first();
  await esc.waitFor();
  await page.waitForTimeout(1500);
  await shot("escrow-panel", await clipAt(esc));

  await page.goto(`${WEB}/client`);
  await shot("client-dashboard");
  await ctx.close();
}
await browser.close();
console.log("shots written to", OUT);
