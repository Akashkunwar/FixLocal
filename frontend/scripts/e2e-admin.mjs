/**
 * SUPERSEDED — kept for reference only. This browser script targets the UI from before the
 * Client/Professional redesign (e.g. /homeowner URLs, a one-page job form) and no longer runs.
 * Its checks live on in the Playwright suite: `npm run test:e2e` (frontend/e2e/*.spec.ts).
 */
import { chromium } from "playwright";

const FRONT = process.env.FRONT_URL || "http://localhost:5173";
const API = process.env.API_URL || "http://localhost:3001";
const PASS = "Password123!";

async function api(pathname, { method = "GET", token, body, formData } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !formData) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: formData || payload,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status} ${data.message || ""}`);
  return data;
}

async function loginApi(email, password = PASS) {
  return api("/api/auth/login", { method: "POST", body: { email, password } });
}

async function main() {
  const results = [];
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const ts = Date.now();

  page.on("dialog", async (d) => d.accept());

  try {
    // Setup: pending pro + disputed job
    const proEmail = `step10.pro.${ts}@example.com`;
    const proReg = await api("/api/auth/register", {
      method: "POST",
      body: { email: proEmail, password: "secret12", role: "TRADESPERSON" },
    });
    const home = await loginApi("home@fixlocal.local");
    const adminApi = await loginApi("admin@fixlocal.local");

    // verify temporarily so we can bid, then create awarded→dispute path with a *different* pending pro for UI verify
    await api(`/api/admin/tradespeople/${proReg.user.id}/verify`, {
      method: "PATCH",
      token: adminApi.token,
      body: { status: "verified" },
    });

    const fd = new FormData();
    fd.append("title", `Admin dispute job ${ts}`);
    fd.append("description", "for admin UI dispute resolve");
    fd.append("category", "plumbing");
    fd.append("maxBids", "3");
    const jobRes = await fetch(`${API}/api/jobs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${home.token}` },
      body: fd,
    });
    const jobBody = await jobRes.json();
    if (!jobRes.ok) throw new Error(jobBody.message);
    const jobId = jobBody.job.id;

    const bid = await api(`/api/jobs/${jobId}/bids`, {
      method: "POST",
      token: proReg.token,
      body: { amount: 700, message: "admin e2e" },
    });
    await api(`/api/bids/${bid.bid.id}/accept`, {
      method: "POST",
      token: home.token,
    });
    await api("/api/disputes", {
      method: "POST",
      token: home.token,
      body: { jobId, reason: `Dispute for admin UI ${ts}` },
    });
    results.push("API setup: open dispute ready");

    // Another pending pro for verify UI (re-register style: set pending on seed? use new user left pending)
    const pendingEmail = `step10.pending.${ts}@example.com`;
    const pending = await api("/api/auth/register", {
      method: "POST",
      body: { email: pendingEmail, password: "secret12", role: "TRADESPERSON" },
    });
    results.push(`API pending pro ${pending.user.id}`);

    // Non-admin cannot open admin pages
    await page.goto(`${FRONT}/login`);
    await page.fill('input[type="email"]', "home@fixlocal.local");
    await page.fill('input[type="password"]', PASS);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/homeowner");
    await page.goto(`${FRONT}/admin`);
    await page.waitForURL("**/homeowner");
    results.push("non-admin blocked from /admin");
    await page.getByRole("button", { name: /log out/i }).click();

    // Admin login → stats
    await page.fill('input[type="email"]', "admin@fixlocal.local");
    await page.fill('input[type="password"]', PASS);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/admin");
    await page.getByText("Total users").waitFor();
    await page.getByText("Pending verifications").waitFor();
    const pendingCount = await page
      .locator(".stat")
      .filter({ hasText: "Pending verifications" })
      .locator(".stat-value")
      .innerText();
    if (!/^\d+$/.test(pendingCount.trim())) throw new Error("stats not numeric");
    results.push(`stats load (pending verifications=${pendingCount.trim()})`);

    // Verify pending pro
    await page.getByRole("link", { name: /^verify$/i }).click();
    await page.waitForURL("**/admin/tradespeople");
    await page.getByText(pendingEmail).waitFor();
    const row = page.locator("li").filter({ hasText: pendingEmail });
    await row.getByRole("button", { name: /^verify$/i }).click();
    await page.selectOption("select", "verified");
    await page.getByRole("button", { name: /^filter$/i }).click();
    await page.getByText(pendingEmail).waitFor();
    await page
      .locator("li")
      .filter({ hasText: pendingEmail })
      .locator(".badge", { hasText: "verified" })
      .waitFor();
    results.push("verify a pro via UI");

    // Resolve dispute
    await page.getByRole("link", { name: /disputes/i }).click();
    await page.waitForURL("**/admin/disputes");
    const disputeRow = page.locator("li.panel").filter({ hasText: `Dispute for admin UI ${ts}` });
    await disputeRow.waitFor();
    await disputeRow.getByPlaceholder(/resolution notes/i).fill("Resolved in UI test");
    await disputeRow.getByRole("button", { name: /favor homeowner/i }).click();
    await page.selectOption("select", "resolved");
    await page.getByRole("button", { name: /^filter$/i }).click();
    await page
      .locator("li.panel")
      .filter({ hasText: `Dispute for admin UI ${ts}` })
      .getByText(/favor_homeowner|Resolved/i)
      .first()
      .waitFor();
    results.push("resolve a dispute via UI");

    // Optional force-cancel
    const openFd = new FormData();
    openFd.append("title", `Force cancel UI ${ts}`);
    openFd.append("description", "moderation");
    openFd.append("category", "other");
    const openJobRes = await fetch(`${API}/api/jobs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${home.token}` },
      body: openFd,
    });
    const openJob = await openJobRes.json();
    if (!openJobRes.ok) throw new Error(openJob.message);

    await page.getByRole("link", { name: /^jobs$/i }).click();
    await page.waitForURL("**/admin/jobs");
    await page.getByText(`Force cancel UI ${ts}`).waitFor();
    const jobRow = page.locator("li").filter({ hasText: `Force cancel UI ${ts}` });
    await jobRow.getByRole("button", { name: /force cancel/i }).click();
    await page
      .locator("li")
      .filter({ hasText: `Force cancel UI ${ts}` })
      .locator(".badge", { hasText: "cancelled" })
      .waitFor({ timeout: 8000 })
      .catch(async () => {
        // may disappear from open filter — switch to cancelled
        await page.selectOption("select", "cancelled");
        await page.getByRole("button", { name: /^filter$/i }).click();
        await page.getByText(`Force cancel UI ${ts}`).waitFor();
      });
    results.push("force-cancel job via UI");

    console.log(results.map((r) => `PASS: ${r}`).join("\n"));
    console.log("\nALL STEP 10 E2E TESTS PASSED");
  } catch (err) {
    console.error("FAIL:", err);
    console.error("URL:", page.url());
    console.error("Results:", results);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
