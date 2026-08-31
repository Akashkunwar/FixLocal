import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const FRONT = process.env.FRONT_URL || "http://localhost:5173";
const API = process.env.API_URL || "http://localhost:3001";
const PASS = "Password123!";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

async function loginApi(email) {
  const data = await api("/api/auth/login", {
    method: "POST",
    body: { email, password: PASS },
  });
  return data;
}

async function main() {
  const results = [];
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // tiny png for upload
  const pngPath = path.join(__dirname, "tmp-step8.png");
  fs.writeFileSync(
    pngPath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    )
  );

  try {
    const title = `UI job ${Date.now()}`;

    // Login homeowner in UI
    await page.goto(`${FRONT}/login`);
    await page.fill('input[type="email"]', "home@fixlocal.local");
    await page.fill('input[type="password"]', PASS);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/homeowner");
    results.push("login homeowner");

    // Create job with image
    await page.getByRole("link", { name: /post a job/i }).click();
    await page.waitForURL("**/homeowner/jobs/new");
    await page.fill('input[name="title"]', title);
    await page.fill('textarea[name="description"]', "Kitchen sink leaking for UI test");
    await page.selectOption('select[name="category"]', "plumbing");
    await page.fill('input[name="area"]', "Koramangala");
    await page.fill('input[name="budgetMin"]', "400");
    await page.fill('input[name="budgetMax"]', "1800");
    await page.setInputFiles('input[name="photos"]', pngPath);
    await page.getByRole("button", { name: /create job/i }).click();
    await page.waitForURL(/\/homeowner\/jobs\/[0-9a-f-]+/);
    await page.getByText(title).first().waitFor();
    await page.locator("img").first().waitFor({ timeout: 5000 });
    const jobUrl = page.url();
    const jobId = jobUrl.split("/").pop();
    results.push(`create job with image → detail ${jobId}`);

    // List shows job
    await page.goto(`${FRONT}/homeowner`);
    await page.getByText(title).first().waitFor();
    results.push("job appears in list");

    // Open detail
    await page.getByRole("link", { name: new RegExp(title) }).click();
    await page.waitForURL(`**/homeowner/jobs/${jobId}`);
    results.push("open detail");

    // Setup: verify seed pro + place bid via API
    const admin = await loginApi("admin@fixlocal.local");
    const pro = await loginApi("pro@fixlocal.local");
    await api(`/api/admin/tradespeople/${pro.user.id}/verify`, {
      method: "PATCH",
      token: admin.token,
      body: { status: "verified" },
    });
    const bidRes = await api(`/api/jobs/${jobId}/bids`, {
      method: "POST",
      token: pro.token,
      body: { amount: 999, message: "I can fix today", etaDays: 1 },
    });
    results.push("API: verify pro + place bid");

    await page.reload();
    await page.getByText("I can fix today").waitFor();
    await page.getByRole("button", { name: /^accept$/i }).click();
    await page.getByText("awarded", { exact: false }).first().waitFor();
    results.push("accept bid → awarded");

    // Complete
    await page.getByRole("button", { name: /mark completed/i }).click();
    await page.getByText("completed", { exact: false }).first().waitFor();
    results.push("mark completed");

    // Open dispute
    await page.fill("textarea", "Work quality issue for dispute test");
    await page.getByRole("button", { name: /submit dispute/i }).click();
    await page.getByText(/dispute is open|disputed/i).first().waitFor();
    results.push("open dispute");

    // Error shown in UI: submit create without description (bypass HTML required)
    await page.goto(`${FRONT}/homeowner/jobs/new`);
    await page.fill('input[name="title"]', `Err job ${Date.now()}`);
    await page.fill('textarea[name="description"]', "tmp");
    await page.evaluate(() => {
      const t = document.querySelector('textarea[name="description"]');
      t?.removeAttribute("required");
      if (t) t.value = "";
    });
    await page.getByRole("button", { name: /create job/i }).click();
    await page.locator(".alert").waitFor({ timeout: 8000 });
    const alertText = await page.locator(".alert").innerText();
    if (!/required|fail|could not/i.test(alertText)) {
      throw new Error(`unexpected alert: ${alertText}`);
    }
    results.push(`error alert shown on failed create: ${alertText}`);

    console.log(results.map((r) => `PASS: ${r}`).join("\n"));
    console.log("\nALL STEP 8 E2E TESTS PASSED");
  } catch (err) {
    console.error("FAIL:", err);
    console.error("URL:", page.url());
    console.error("Results:", results);
    process.exit(1);
  } finally {
    fs.unlinkSync(pngPath);
    await browser.close();
  }
}

main();
