/**
 * Full visual E2E — headed browser, slowMo + pauses so you can watch every screen.
 *
 *   cd frontend && npm run e2e:visual
 *
 * Env:
 *   PAUSE_MS=2500   (default 2500 — stay on each screen)
 *   SLOW_MO=800     (default 800 — slow each Playwright action)
 *   HEADLESS=1      (optional — run without window)
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const FRONT = process.env.FRONT_URL || "http://localhost:5173";
const API = process.env.API_URL || "http://localhost:3001";
const PASS = process.env.SEED_PASSWORD || "Password123!";
const PAUSE_MS = Number(process.env.PAUSE_MS || 2500);
const SLOW_MO = Number(process.env.SLOW_MO || 800);
const HEADLESS = process.env.HEADLESS === "1";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const seen = [];

async function api(pathname, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${pathname} → ${res.status} ${data.message || ""}`);
  }
  return data;
}

async function show(page, label) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(PAUSE_MS);
  seen.push(`${label} @ ${page.url()}`);
  console.log(`▶ ${label}`);
}

async function loginUi(page, email) {
  await page.goto(`${FRONT}/login`);
  await show(page, "Login page");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASS);
  await page.getByRole("button", { name: /sign in/i }).click();
}

async function logoutUi(page) {
  const btn = page.getByRole("button", { name: /log out/i });
  if (await btn.count()) {
    await btn.click();
    await page.waitForURL("**/login");
  }
}

async function main() {
  const health = await fetch(`${API}/health`).then((r) => r.json());
  console.log("API health:", health);
  const frontOk = await fetch(FRONT).then((r) => r.ok);
  if (!frontOk) throw new Error(`Frontend not up at ${FRONT}`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: SLOW_MO,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const ts = Date.now();
  const title = `Visual tour job ${ts}`;

  const pngPath = path.join(__dirname, "tmp-visual.png");
  fs.writeFileSync(
    pngPath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    )
  );

  try {
    // Reset pro to pending so verify screen is meaningful
    const adminLogin = await api("/api/auth/login", {
      method: "POST",
      body: { email: "admin@fixlocal.local", password: PASS },
    });
    const proLogin = await api("/api/auth/login", {
      method: "POST",
      body: { email: "pro@fixlocal.local", password: PASS },
    });
    await api(`/api/admin/tradespeople/${proLogin.user.id}/verify`, {
      method: "PATCH",
      token: adminLogin.token,
      body: { status: "pending" },
    });

    // ——— Public pages ———
    await page.goto(`${FRONT}/login`);
    await show(page, "Login");
    await page.getByRole("link", { name: /register/i }).click();
    await page.waitForURL("**/register");
    await show(page, "Register");

    // ——— Admin: all pages ———
    await loginUi(page, "admin@fixlocal.local");
    await page.waitForURL("**/admin");
    await show(page, "Admin — Stats");

    await page.getByRole("link", { name: /^verify$/i }).click();
    await page.waitForURL("**/admin/tradespeople");
    await show(page, "Admin — Verify tradespeople");

    const proRow = page.locator("li").filter({ hasText: "pro@fixlocal.local" });
    await proRow.waitFor();
    await proRow.getByRole("button", { name: /^verify$/i }).click();
    await page.waitForTimeout(PAUSE_MS);

    await page.getByRole("link", { name: /disputes/i }).click();
    await page.waitForURL("**/admin/disputes");
    await show(page, "Admin — Disputes");

    await page.getByRole("link", { name: /^jobs$/i }).click();
    await page.waitForURL("**/admin/jobs");
    await show(page, "Admin — Jobs");
    await logoutUi(page);

    // ——— Homeowner: dashboard + create + detail ———
    await loginUi(page, "home@fixlocal.local");
    await page.waitForURL("**/homeowner");
    await show(page, "Homeowner — My jobs");

    await page.getByRole("link", { name: /post a job/i }).click();
    await page.waitForURL("**/homeowner/jobs/new");
    await show(page, "Homeowner — Create job");

    await page.fill('input[name="title"]', title);
    await page.fill(
      'textarea[name="description"]',
      "Visual E2E: kitchen tap drip — watch the screens"
    );
    await page.selectOption('select[name="category"]', "plumbing");
    await page.fill('input[name="area"]', "Visnagar");
    await page.setInputFiles('input[name="photos"]', pngPath);
    await page.waitForTimeout(PAUSE_MS);
    await page.getByRole("button", { name: /create job/i }).click();
    await page.waitForURL(/\/homeowner\/jobs\/[0-9a-f-]+/);
    await show(page, "Homeowner — Job detail (open)");
    await logoutUi(page);

    // ——— Tradesperson: browse, profile, bid ———
    await loginUi(page, "pro@fixlocal.local");
    await page.waitForURL("**/tradesperson");
    await show(page, "Tradesperson — Browse jobs");

    await page.getByRole("link", { name: /profile/i }).click();
    await page.waitForURL("**/tradesperson/profile");
    await show(page, "Tradesperson — Profile");

    await page.getByRole("link", { name: /my jobs/i }).click();
    await page.waitForURL("**/tradesperson/my-jobs");
    await show(page, "Tradesperson — My jobs");

    await page.getByRole("link", { name: /browse jobs/i }).click();
    await page.getByPlaceholder("Search…").fill(String(ts));
    await page.getByRole("button", { name: /^filter$/i }).click();
    await page.getByRole("link", { name: new RegExp(title) }).click();
    await page.waitForURL(/\/tradesperson\/jobs\//);
    await show(page, "Tradesperson — Job detail (bid)");

    await page.getByLabel(/amount/i).fill("1800");
    await page.getByLabel(/^message$/i).fill("Visual tour bid");
    await page.getByRole("button", { name: /place bid/i }).click();
    await page.getByRole("button", { name: /withdraw bid/i }).waitFor();
    await show(page, "Tradesperson — Bid placed");
    await logoutUi(page);

    // ——— Homeowner accept + complete + dispute ———
    await loginUi(page, "home@fixlocal.local");
    await page.waitForURL("**/homeowner");
    await page.getByRole("link", { name: new RegExp(title) }).click();
    await show(page, "Homeowner — Job with bids");
    await page.getByRole("button", { name: /^accept$/i }).click();
    await page.locator(".badge", { hasText: "awarded" }).first().waitFor();
    await show(page, "Homeowner — Awarded");

    await page.getByRole("button", { name: /mark completed/i }).click();
    await page.locator(".badge", { hasText: "completed" }).first().waitFor();
    await show(page, "Homeowner — Completed");

    await page.fill("textarea", "Visual tour dispute — finish incomplete");
    await page.getByRole("button", { name: /submit dispute/i }).click();
    await page.getByText(/dispute is open|disputed/i).first().waitFor();
    await show(page, "Homeowner — Dispute opened");
    await logoutUi(page);

    // ——— Admin resolve ———
    await loginUi(page, "admin@fixlocal.local");
    await page.getByRole("link", { name: /disputes/i }).click();
    await show(page, "Admin — Open dispute");
    const dRow = page
      .locator("li.panel")
      .filter({ hasText: "Visual tour dispute" });
    await dRow.waitFor();
    await dRow.getByRole("button", { name: /favor homeowner/i }).click();
    await page.selectOption("select", "resolved");
    await page.getByRole("button", { name: /^filter$/i }).click();
    await show(page, "Admin — Dispute resolved");

    // Wrong-role check (quick)
    await logoutUi(page);
    await loginUi(page, "home@fixlocal.local");
    await page.goto(`${FRONT}/admin`);
    await page.waitForURL((u) => !u.pathname.startsWith("/admin") || u.pathname === "/login");
    await show(page, "RBAC — homeowner blocked from /admin");

    console.log("\n=== SCREENS VISITED ===");
    seen.forEach((s, i) => console.log(`${i + 1}. ${s}`));
    console.log("\nVISUAL E2E PASSED");
  } catch (err) {
    console.error("\nFAIL:", err);
    console.error("URL:", page.url());
    console.error("Seen so far:", seen);
    process.exitCode = 1;
  } finally {
    try {
      fs.unlinkSync(pngPath);
    } catch {
      /* ignore */
    }
    await page.waitForTimeout(1500);
    await browser.close();
  }
}

main();
