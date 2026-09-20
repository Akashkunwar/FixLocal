/**
 * SUPERSEDED — kept for reference only. This browser script targets the UI from before the
 * Client/Professional redesign (e.g. /homeowner URLs, a one-page job form) and no longer runs.
 * Its checks live on in the Playwright suite: `npm run test:e2e` (frontend/e2e/*.spec.ts).
 */
import { chromium } from "playwright";

const FRONT = process.env.FRONT_URL || "http://localhost:5173";
const API = process.env.API_URL || "http://localhost:3001";
const PASS = "Password123!";

async function api(pathname, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
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

  try {
    // Fresh unverified pro via register API
    const email = `step9.pro.${ts}@example.com`;
    const reg = await api("/api/auth/register", {
      method: "POST",
      body: { email, password: "secret12", role: "TRADESPERSON" },
    });
    results.push("API register unverified pro");

    // Home creates two open jobs (withdraw blocks rebid on same job)
    const home = await loginApi("home@fixlocal.local");
    async function createJob(title) {
      const fd = new FormData();
      fd.append("title", title);
      fd.append("description", "Need electrician for Step 9 UI test");
      fd.append("category", "electrical");
      fd.append("area", "Whitefield");
      fd.append("maxBids", "5");
      fd.append("budgetMax", "3000");
      const createRes = await fetch(`${API}/api/jobs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${home.token}` },
        body: fd,
      });
      const created = await createRes.json();
      if (!createRes.ok) throw new Error(created.message || "create job failed");
      return created.job;
    }
    const jobTitle = `Pro UI job ${ts}`;
    const jobTitle2 = `Pro UI awarded ${ts}`;
    const job = await createJob(jobTitle);
    const job2 = await createJob(jobTitle2);
    const jobId = job.id;
    const jobId2 = job2.id;
    results.push(`API home created open jobs ${jobId}, ${jobId2}`);

    // 1) Unverified login → clear block on browse + detail
    await page.goto(`${FRONT}/login`);
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', "secret12");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/tradesperson");
    await page.getByText(/cannot place bids until an admin verifies/i).waitFor();
    results.push("unverified sees clear block on browse");

    // Profile edit
    await page.getByRole("link", { name: /profile/i }).click();
    await page.waitForURL("**/tradesperson/profile");
    await page.getByText(/cannot place bids until an admin/i).waitFor();
    await page.locator("textarea").nth(0).fill("electrical, wiring");
    await page.locator("textarea").nth(1).fill("Whitefield, Indiranagar");
    await page.getByRole("button", { name: /save profile/i }).click();
    await page.getByText(/profile saved/i).waitFor();
    results.push("profile edit saved");

    // Browse filter
    await page.getByRole("link", { name: /browse jobs/i }).click();
    await page.selectOption("select", "electrical");
    await page.getByPlaceholder("Search…").fill(String(ts));
    await page.getByRole("button", { name: /^filter$/i }).click();
    await page.getByText(jobTitle).waitFor();
    results.push("browse filters work");

    // Open job — cannot bid
    await page.getByRole("link", { name: new RegExp(jobTitle) }).click();
    await page.waitForURL(`**/tradesperson/jobs/${jobId}`);
    await page.getByText(/cannot bid until an admin verifies/i).waitFor();
    const placeVisible = await page.getByRole("button", { name: /place bid/i }).count();
    if (placeVisible) throw new Error("place bid should be hidden when unverified");
    results.push("unverified blocked from bidding on detail");

    // 2) Admin verify
    const admin = await loginApi("admin@fixlocal.local");
    await api(`/api/admin/tradespeople/${reg.user.id}/verify`, {
      method: "PATCH",
      token: admin.token,
      body: { status: "verified" },
    });
    results.push("admin verified pro");

    await page.reload();
    await page.getByLabel(/amount/i).fill("1500");
    await page.getByLabel(/^message$/i).fill("Can start tomorrow");
    await page.getByRole("button", { name: /place bid/i }).click();
    await page.getByText(/₹1500|1500/).first().waitFor();
    await page.getByRole("button", { name: /withdraw bid/i }).waitFor();
    results.push("after verify can bid");

    // Withdraw
    await page.getByRole("button", { name: /withdraw bid/i }).click();
    await page.getByRole("button", { name: /place bid/i }).waitFor();
    results.push("withdraw works");

    // Bid on second job (cannot rebid withdrawn job), home accepts
    await page.goto(`${FRONT}/tradesperson/jobs/${jobId2}`);
    await page.getByLabel(/amount/i).fill("1400");
    await page.getByLabel(/^message$/i).fill("Award path bid");
    await page.getByRole("button", { name: /place bid/i }).click();
    await page.getByRole("button", { name: /withdraw bid/i }).waitFor();

    const bids = await api(`/api/jobs/${jobId2}/bids`, { token: home.token });
    const myBid = bids.bids.find((b) => b.tradespersonId === reg.user.id && b.status === "active");
    if (!myBid) throw new Error("active bid missing");
    await api(`/api/bids/${myBid.id}/accept`, { method: "POST", token: home.token });
    results.push("home accepted bid on job 2");

    // My jobs: start + complete
    await page.getByRole("link", { name: /my jobs/i }).click();
    await page.waitForURL("**/tradesperson/my-jobs");
    await page.getByText(jobTitle2).waitFor();
    await page.getByRole("button", { name: /start work/i }).click();
    await page.locator(".badge", { hasText: "in_progress" }).first().waitFor();
    results.push("awarded → start → in_progress");

    await page.getByRole("button", { name: /mark completed/i }).click();
    await page.locator(".badge", { hasText: "completed" }).first().waitFor();
    results.push("in_progress → completed");

    console.log(results.map((r) => `PASS: ${r}`).join("\n"));
    console.log("\nALL STEP 9 E2E TESTS PASSED");
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
