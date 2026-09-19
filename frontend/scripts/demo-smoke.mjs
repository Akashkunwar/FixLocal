/**
 * SUPERSEDED — kept for reference only. This browser script targets the UI from before the
 * Client/Professional redesign (e.g. /homeowner URLs, a one-page job form) and no longer runs.
 * Its checks live on in the Playwright suite: `npm run test:e2e` (frontend/e2e/*.spec.ts).
 */
/**
 * README demo smoke: admin verifies pro → home posts job → pro bids →
 * home accepts → complete → optional dispute.
 * Requires: backend :3001, frontend :5173, seed users present.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const FRONT = process.env.FRONT_URL || "http://localhost:5173";
const API = process.env.API_URL || "http://localhost:3001";
const PASS = process.env.SEED_PASSWORD || "Password123!";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

async function loginUi(page, email) {
  await page.goto(`${FRONT}/login`);
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
  const results = [];
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const ts = Date.now();
  const title = `Demo smoke job ${ts}`;

  const pngPath = path.join(__dirname, "tmp-demo.png");
  fs.writeFileSync(
    pngPath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    )
  );

  try {
    // Ensure seed pro starts pending so verify step is meaningful
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
    results.push("reset pro to pending (API precondition)");

    // 1) Admin verifies pro
    await loginUi(page, "admin@fixlocal.local");
    await page.waitForURL("**/admin");
    await page.getByText("Pending verifications").waitFor();
    await page.getByRole("link", { name: /^verify$/i }).click();
    await page.waitForURL("**/admin/tradespeople");
    const proRow = page.locator("li").filter({ hasText: "pro@fixlocal.local" });
    await proRow.waitFor();
    await proRow.getByRole("button", { name: /^verify$/i }).click();
    await page.selectOption("select", "verified");
    await page.getByRole("button", { name: /^filter$/i }).click();
    await page
      .locator("li")
      .filter({ hasText: "pro@fixlocal.local" })
      .locator(".badge", { hasText: "verified" })
      .waitFor();
    results.push("1. admin verified pro@fixlocal.local");
    await logoutUi(page);

    // 2) Home posts job (+ image)
    await loginUi(page, "home@fixlocal.local");
    await page.waitForURL("**/homeowner");
    await page.getByRole("link", { name: /post a job/i }).click();
    await page.fill('input[name="title"]', title);
    await page.fill('textarea[name="description"]', "Demo: leaky tap — README smoke");
    await page.selectOption('select[name="category"]', "plumbing");
    await page.fill('input[name="area"]', "Demo Nagar");
    await page.setInputFiles('input[name="photos"]', pngPath);
    await page.getByRole("button", { name: /create job/i }).click();
    await page.waitForURL(/\/homeowner\/jobs\/[0-9a-f-]+/);
    await page.getByText(title).first().waitFor();
    results.push("2. homeowner posted job with image");
    await logoutUi(page);

    // 3) Pro bids
    await loginUi(page, "pro@fixlocal.local");
    await page.waitForURL("**/tradesperson");
    await page.getByPlaceholder("Search…").fill(String(ts));
    await page.getByRole("button", { name: /^filter$/i }).click();
    await page.getByRole("link", { name: new RegExp(title) }).click();
    await page.getByLabel(/amount/i).fill("1250");
    await page.getByLabel(/^message$/i).fill("Demo bid from README smoke");
    await page.getByRole("button", { name: /place bid/i }).click();
    await page.getByRole("button", { name: /withdraw bid/i }).waitFor();
    results.push("3. tradesperson placed bid");
    await logoutUi(page);

    // 4) Home accepts
    await loginUi(page, "home@fixlocal.local");
    await page.waitForURL("**/homeowner");
    await page.getByRole("link", { name: new RegExp(title) }).click();
    await page.getByRole("button", { name: /^accept$/i }).click();
    await page.locator(".badge", { hasText: "awarded" }).first().waitFor();
    results.push("4. homeowner accepted bid → awarded");

    // 5) Complete (homeowner)
    await page.getByRole("button", { name: /mark completed/i }).click();
    await page.locator(".badge", { hasText: "completed" }).first().waitFor();
    results.push("5. homeowner marked completed");

    // 6) Optional dispute
    await page.fill("textarea", "Optional demo dispute — incomplete finish");
    await page.getByRole("button", { name: /submit dispute/i }).click();
    await page.getByText(/dispute is open|disputed/i).first().waitFor();
    results.push("6. optional dispute opened");

    await logoutUi(page);
    await loginUi(page, "admin@fixlocal.local");
    await page.getByRole("link", { name: /disputes/i }).click();
    const dRow = page.locator("li.panel").filter({ hasText: "Optional demo dispute" });
    await dRow.waitFor();
    await dRow.getByRole("button", { name: /favor homeowner/i }).click();
    await page.selectOption("select", "resolved");
    await page.getByRole("button", { name: /^filter$/i }).click();
    await page
      .locator("li.panel")
      .filter({ hasText: "Optional demo dispute" })
      .getByText(/favor_homeowner|Resolved/i)
      .first()
      .waitFor();
    results.push("6b. admin resolved dispute");

    console.log(results.map((r) => `PASS: ${r}`).join("\n"));
    console.log("\nREADME DEMO SMOKE PASSED");
  } catch (err) {
    console.error("FAIL:", err);
    console.error("URL:", page.url());
    console.error("Results so far:", results);
    process.exit(1);
  } finally {
    try {
      fs.unlinkSync(pngPath);
    } catch {
      /* ignore */
    }
    await browser.close();
  }
}

main();
