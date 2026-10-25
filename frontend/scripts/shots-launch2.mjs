// Second-pass screenshots (desktop 1280 + mobile 390): signed-out pro profile, sign-up "check your inbox",
// and the login error with the resend link. Usage: API=… WEB=… OUT=… node scripts/shots-launch2.mjs
import { chromium, request as pwRequest } from "@playwright/test";
import fs from "node:fs";

const API = process.env.API || "http://localhost:3001";
const WEB = process.env.WEB || "http://localhost:5173";
const OUT = process.env.OUT || "../fixlocal-shots";
const PASSWORD = process.env.SEED_PASSWORD || "Password123!";
fs.mkdirSync(OUT, { recursive: true });

const api = await pwRequest.newContext({ baseURL: API });
const r = await api.post("/api/auth/login", { data: { email: "pro@fixlocal.local", password: PASSWORD } });
if (!r.ok()) throw new Error(`login: ${r.status()}`);
const proId = (await r.json()).user.id;

const browser = await chromium.launch();
const saved = [];
for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.route(/tile\.openstreetmap\.org/, (route) => route.abort());
  const shot = async (name) => {
    const file = `${OUT}/launch2-${name}-${size}.png`;
    await page.waitForTimeout(500);
    await page.screenshot({ path: file, fullPage: true });
    saved.push(file);
  };

  await page.goto(`${WEB}/pros/${proId}`);
  await page.getByRole("link", { name: "Sign up to get a quote" }).waitFor();
  await shot("public-pro-profile");

  await page.goto(`${WEB}/register`);
  await page.getByLabel("Full name").fill("Inbox Demo");
  await page.getByLabel("Email").fill(`inbox-demo-${Date.now()}-${size}@example.com`);
  await page.getByLabel("Password").fill("Demo-Password-123");
  await page.getByRole("checkbox", { name: /agree to the Terms/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "Check your inbox" }).waitFor();
  await shot("signup-check-inbox");

  await page.goto(`${WEB}/login`);
  await page.getByLabel("Email").fill("someone@example.com");
  await page.getByLabel("Password").fill("Wrong-Password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Resend the confirmation link" }).waitFor();
  await shot("login-generic-error");
  await ctx.close();
}
await browser.close();
console.log(saved.join("\n"));
