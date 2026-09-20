/**
 * SUPERSEDED — kept for reference only. This browser script targets the UI from before the
 * Client/Professional redesign (e.g. /homeowner URLs, a one-page job form) and no longer runs.
 * Its checks live on in the Playwright suite: `npm run test:e2e` (frontend/e2e/*.spec.ts).
 */
import { chromium } from "playwright";

const BASE = process.env.FRONT_URL || "http://localhost:5173";
const PASS = "Password123!";

async function expectText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout: 8000 });
}

async function loginAs(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASS);
  await page.getByRole("button", { name: /sign in/i }).click();
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const results = [];

  try {
    // 1) Admin → admin dashboard
    await loginAs(page, "admin@fixlocal.local");
    await page.waitForURL("**/admin");
    await expectText(page, "Admin dashboard");
    results.push("login admin → /admin OK");

    // wrong-role URL blocked
    await page.goto(`${BASE}/homeowner`);
    await page.waitForURL("**/admin");
    results.push("admin blocked from /homeowner → redirect /admin OK");

    await page.getByRole("button", { name: /log out/i }).click();
    await page.waitForURL("**/login");
    results.push("logout → /login OK");

    // 2) Homeowner
    await loginAs(page, "home@fixlocal.local");
    await page.waitForURL("**/homeowner");
    await expectText(page, "Homeowner dashboard");
    results.push("login home → /homeowner OK");

    await page.goto(`${BASE}/admin`);
    await page.waitForURL("**/homeowner");
    results.push("homeowner blocked from /admin OK");
    await page.getByRole("button", { name: /log out/i }).click();

    // 3) Tradesperson
    await loginAs(page, "pro@fixlocal.local");
    await page.waitForURL("**/tradesperson");
    await expectText(page, "Tradesperson dashboard");
    results.push("login pro → /tradesperson OK");

    await page.goto(`${BASE}/admin`);
    await page.waitForURL("**/tradesperson");
    results.push("pro blocked from /admin OK");
    await page.getByRole("button", { name: /log out/i }).click();

    // 4) token missing → protected route sends to login
    await page.goto(`${BASE}/homeowner`);
    await page.waitForURL("**/login");
    results.push("no token → /homeowner redirects /login OK");

    // 5) Register homeowner
    const email = `ui.home.${Date.now()}@example.com`;
    await page.goto(`${BASE}/register`);
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', "secret12");
    await page.selectOption("select", "HOMEOWNER");
    await page.getByRole("button", { name: /register/i }).click();
    await page.waitForURL("**/homeowner");
    await expectText(page, "Homeowner dashboard");
    results.push(`register homeowner ${email} → /homeowner OK`);

    console.log(results.map((r) => `PASS: ${r}`).join("\n"));
    console.log("\nALL STEP 7 E2E TESTS PASSED");
  } catch (err) {
    console.error("FAIL:", err);
    console.error("URL:", page.url());
    console.error("Results so far:", results);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
