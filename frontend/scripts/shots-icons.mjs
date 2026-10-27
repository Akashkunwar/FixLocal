// Before/after screenshots for the emoji → icon change (desktop 1280 + mobile 390) against the dev stack.
// Usage: PHASE=before|after API=http://localhost:3001 WEB=http://localhost:5173 OUT=/workspace/fixlocal-shots node scripts/shots-icons.mjs
import { chromium, request as pwRequest } from "@playwright/test";
import fs from "node:fs";

const API = process.env.API || "http://localhost:3001";
const WEB = process.env.WEB || "http://localhost:5173";
const OUT = process.env.OUT || "../fixlocal-shots";
const PHASE = process.env.PHASE || "after";
const PASSWORD = process.env.SEED_PASSWORD || "Password123!";
fs.mkdirSync(OUT, { recursive: true });

const api = await pwRequest.newContext({ baseURL: API });
const login = async (email) => {
  const r = await api.post("/api/auth/login", { data: { email, password: PASSWORD } });
  if (!r.ok()) throw new Error(`login ${email}: ${r.status()}`);
  return (await r.json());
};
const client = await login("home@fixlocal.local");
const { jobs } = await (await api.get("/api/jobs?limit=20", { headers: { Authorization: `Bearer ${client.token}` } })).json();
const job = jobs.find((j) => j.status === "open") || jobs[0];
if (!job) throw new Error("seeded client has no jobs");

const browser = await chromium.launch();
const saved = [];
for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.route(/tile\.openstreetmap\.org/, (route) => route.abort());
  const shot = async (name, locator) => {
    const file = `${OUT}/icons-${PHASE}-${name}-${size}.png`;
    await page.waitForTimeout(800);
    if (locator) {
      await locator.scrollIntoViewIfNeeded();
      await locator.screenshot({ path: file });
    } else await page.screenshot({ path: file, fullPage: false });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    if (wide) throw new Error(`${name} (${size}) scrolls sideways`);
    saved.push(file);
  };
  const signIn = async (email) => {
    await ctx.clearCookies();
    await page.goto(`${WEB}/login`);
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${WEB}/login`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  };

  await page.goto(`${WEB}/`);
  await page.locator("h1").first().waitFor();
  await shot("landing-top");
  const grid = page.locator("section").filter({ hasText: /Plumbing/ }).first();
  await shot("landing-categories", grid);

  await signIn("home@fixlocal.local");
  await page.goto(`${WEB}/client`);
  await page.locator("h1").first().waitFor();
  await page.getByText(job.title).first().waitFor();
  await page.getByText(job.title).first().scrollIntoViewIfNeeded();
  await shot("client-dashboard");
  await page.goto(`${WEB}/client/jobs/new`);
  await page.getByText("Plumbing").first().waitFor();
  await page.getByText("Plumbing").first().scrollIntoViewIfNeeded();
  await shot("wizard-category");
  await page.goto(`${WEB}/client/jobs/${job.id}`);
  await page.locator("h1").first().waitFor();
  await shot("job-detail");
  await page.goto(`${WEB}/client/pros`);
  await page.locator("h1").first().waitFor();
  await shot("find-pros");
  await page.goto(`${WEB}/notifications`);
  await page.locator("h1").first().waitFor();
  await shot("notifications");

  await signIn("pro@fixlocal.local");
  await page.goto(`${WEB}/professional`);
  await page.locator("h1").first().waitFor();
  await page.getByRole("link", { name: /Budget/ }).first().waitFor();
  await page.getByRole("link", { name: /Budget/ }).first().scrollIntoViewIfNeeded();
  await shot("pro-browse");
  await page.goto(`${WEB}/professional/alerts`);
  await page.locator("h1").first().waitFor();
  await shot("pro-alerts");
  await ctx.close();
}
await browser.close();
console.log(saved.join("\n"));
