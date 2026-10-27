// Round-5 feature screenshots (desktop 1280 + mobile 390) against the dev stack.
// Usage: API=http://localhost:3001 WEB=http://localhost:5173 OUT=/workspace/fixlocal-shots node scripts/shots-round5.mjs
import { chromium, request as pwRequest } from "@playwright/test";
import fs from "node:fs";

const API = process.env.API || "http://localhost:3001";
const WEB = process.env.WEB || "http://localhost:5173";
const OUT = process.env.OUT || "../fixlocal-shots";
const PASSWORD = process.env.SEED_PASSWORD || "Password123!";
fs.mkdirSync(OUT, { recursive: true });

const api = await pwRequest.newContext({ baseURL: API });
async function session(email) {
  const r = await api.post("/api/auth/login", { data: { email, password: PASSWORD } });
  if (!r.ok()) throw new Error(`login ${email}: ${r.status()}`);
  const body = await r.json();
  return { id: body.user.id, headers: { Authorization: `Bearer ${body.token}` } };
}
const pro = await session("pro@fixlocal.local");
const client = await session("home@fixlocal.local");

// Data for the shots: one job alert, a referral code with a friend who joined.
const alerts = await (await api.get("/api/job-alerts", { headers: pro.headers })).json();
if (!alerts.alerts?.some((a) => a.name === "Plumbing near Bengaluru")) {
  await api.post("/api/job-alerts", {
    headers: pro.headers,
    data: { name: "Plumbing near Bengaluru", categories: ["plumbing", "electrical"], city: "Bengaluru", minBudget: 500 },
  });
}
const ref = (await (await api.post("/api/referrals/me/code", { headers: client.headers })).json()).referral;
if (ref.totals.joined === 0) {
  await api.post("/api/auth/register", {
    data: { email: `friend-${Date.now()}@example.com`, password: "Demo-Password-123", role: "HOMEOWNER", name: "Meera Shah", acceptTerms: true, referralCode: ref.code },
  });
}

const fireInstall = (page) =>
  page.evaluate(() => {
    const ev = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => undefined,
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });
    window.dispatchEvent(ev);
  });

const browser = await chromium.launch();
const saved = [];
for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.route(/tile\.openstreetmap\.org/, (route) => route.abort());
  const shot = async (name, fullPage = true) => {
    const file = `${OUT}/round5-${name}-${size}.png`;
    await page.waitForTimeout(600);
    await page.screenshot({ path: file, fullPage });
    saved.push(file);
  };
  const login = async (email) => {
    await page.goto(`${WEB}/login`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  };

  // Signed out: install banner, share buttons, invite sign-up, Hindi.
  await page.goto(`${WEB}/`);
  await page.getByRole("heading", { level: 1 }).waitFor();
  await fireInstall(page);
  await page.getByRole("region", { name: "Install app" }).waitFor();
  await shot("install-banner", false);
  await page.goto(`${WEB}/pros/${pro.id}`);
  await page.getByRole("link", { name: "Share on WhatsApp" }).waitFor();
  await shot("pro-profile-share", false);
  await page.goto(`${WEB}/register?ref=${ref.code}`);
  await page.getByText("A friend invited you").waitFor();
  await shot("register-invited");
  await page.goto(`${WEB}/`);
  await page.getByRole("button", { name: /View in Hindi/ }).click();
  await page.getByText("काम पोस्ट करें।").waitFor();
  await shot("hindi-landing", false);
  await page.goto(`${WEB}/login`);
  await shot("hindi-login", false);
  await page.evaluate(() => localStorage.removeItem("fixlocal:lang"));

  // Professional: job alerts + notification centre.
  await login("pro@fixlocal.local");
  await page.goto(`${WEB}/professional/alerts`);
  await page.getByText("Plumbing near Bengaluru").first().waitFor();
  await shot("job-alerts");
  await page.goto(`${WEB}/notifications`);
  await page.getByRole("heading", { name: "Notifications", level: 1 }).waitFor();
  await shot("notifications");
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL(/\/login/);

  // Client: spending, invite friends (Settings), Hindi dashboard.
  await login("home@fixlocal.local");
  await page.goto(`${WEB}/client/spending`);
  await page.getByRole("heading", { name: "Spending", level: 1 }).waitFor();
  await shot("spending");
  await page.goto(`${WEB}/settings`);
  const invite = page.getByRole("region", { name: "Invite friends" });
  await invite.getByLabel(/Your invite link/).waitFor();
  await invite.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await invite.screenshot({ path: `${OUT}/round5-invite-friends-${size}.png` });
  saved.push(`${OUT}/round5-invite-friends-${size}.png`);
  await page.getByRole("radio", { name: /Hindi/ }).check();
  await page.goto(`${WEB}/client`);
  await page.waitForTimeout(800);
  await shot("hindi-client-dashboard", false);
  await page.evaluate(() => localStorage.removeItem("fixlocal:lang"));
  await ctx.close();
}
await browser.close();
console.log(saved.join("\n"));
