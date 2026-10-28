import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { apiCall, apiLogin, awardedJob, login, mailLink, PASSWORD, postJob, SEEDED, uniqueEmail } from "./fixtures";

type Notif = { title: string; type: string; link?: string };

test("a pro saves a job alert and is notified when a matching job is posted", async ({ page, request }) => {
  const pro = await apiLogin(request, SEEDED.pro2);
  const client = await apiLogin(request, SEEDED.client);
  await login(page, SEEDED.pro2);
  await page.goto("/professional/alerts");
  await expect(page.getByRole("heading", { name: "Job alerts", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /Electrical/ }).click();
  await expect(page.getByRole("button", { name: /Electrical/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("City").fill("Bengaluru");
  await page.getByLabel("Name (optional)").fill("E2E electrical alert");
  await expect(page.getByText(/open jobs? from the last 30 days match right now/)).toBeVisible();
  await expect(page.getByRole("radio", { name: /Daily digest/ })).toBeChecked();
  await page.getByRole("radio", { name: /Instant/ }).check();
  await page.getByRole("button", { name: "Save alert" }).click();
  const card = page.getByRole("listitem").filter({ hasText: "E2E electrical alert" });
  await expect(card).toContainText("Electrical · Bengaluru");
  await expect(card.getByLabel("How often for E2E electrical alert")).toHaveValue("instant");

  const title = `E2E alert job ${Date.now().toString(36)}`;
  const job = await postJob(request, client, { title, category: "electrical" });
  await postJob(request, client, { title: `${title} plumbing`, category: "plumbing" });
  const { notifications } = await apiCall<{ notifications: Notif[] }>(request, pro, "get", "/api/notifications");
  const hits = notifications.filter((n) => n.type === "job_alert" && n.title.includes(title));
  expect(hits).toHaveLength(1);
  expect(hits[0].link).toBe(`/professional/jobs/${job.id}`);

  // Switch to the daily digest: new matches wait for the morning summary instead.
  await card.getByLabel("How often for E2E electrical alert").selectOption("daily");
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: "E2E electrical alert" }).getByLabel("How often for E2E electrical alert")).toHaveValue("daily");
  const quiet = `E2E digest job ${Date.now().toString(36)}`;
  await postJob(request, client, { title: quiet, category: "electrical" });
  const after = await apiCall<{ notifications: Notif[] }>(request, pro, "get", "/api/notifications");
  expect(after.notifications.some((n) => n.title.includes(quiet))).toBe(false);

  // Pause, then delete (keeps the shared e2e data quiet for other specs).
  await card.getByRole("button", { name: "Pause E2E electrical alert" }).click();
  await expect(card).toContainText("Paused");
  await card.getByRole("button", { name: "Delete E2E electrical alert" }).click();
  await expect(card).toHaveCount(0);
});

test("notification centre: open from the bell, filter by type, mark all read", async ({ page, request }) => {
  const client = await apiLogin(request, SEEDED.client);
  const pro = await apiLogin(request, SEEDED.pro);
  const job = await postJob(request, client, { title: `E2E notif centre ${Date.now().toString(36)}` });
  await apiCall(request, pro, "post", `/api/jobs/${job.id}/bids`, { amount: 1800, message: "Can come tomorrow." });
  await apiCall(request, pro, "post", `/api/messages/${job.id}`, { body: "Hi, is parking available?" });

  await login(page, SEEDED.client);
  await page.getByRole("button", { name: /Notifications/ }).click();
  await page.getByRole("link", { name: "See all notifications" }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`New bid on your job.*${job.title}`) }).first()).toBeVisible();

  await page.getByRole("button", { name: "Messages" }).click();
  await expect(page.getByRole("button", { name: "Messages" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: /New bid on your job/ })).toHaveCount(0);

  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(page.getByText("You're all caught up").first()).toBeVisible();
  await page.getByLabel("Unread only").check();
  await expect(page.getByText("Nothing here")).toBeVisible();
});

test("client spending page: escrow totals, history filter and CSV download", async ({ page, request }) => {
  const client = await apiLogin(request, SEEDED.client);
  const pro = await apiLogin(request, SEEDED.pro);
  const { job } = await awardedJob(request, client, pro, 2400);
  await login(page, SEEDED.client);
  await page.getByRole("link", { name: "Spending" }).first().click();
  await expect(page.getByRole("heading", { name: "Spending & history", level: 1 })).toBeVisible();
  await expect(page.getByText("Held in escrow", { exact: true })).toBeVisible();
  const row = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: job.title }) });
  await expect(row).toContainText("₹2,400 held");
  await page.getByLabel("Show").selectOption("cancelled");
  await expect(page.getByRole("link", { name: job.title })).toHaveCount(0);
  await page.getByLabel("Show").selectOption("all");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^fixlocal-spending-\d{4}-\d{2}-\d{2}\.csv$/);
  const fs = await import("node:fs");
  const csv = fs.readFileSync((await download.path())!, "utf8");
  expect(csv).toContain(job.title);
  expect(csv).toMatch(/^\ufeff?Posted,Job,Category/);
});

test("a user shares an invite link and sees the friend who joined through it", async ({ page, browser, request }) => {
  // The inviter signs up on a different device than the friend (same-device sign-ups earn nothing).
  const inviterEmail = uniqueEmail("inviter");
  const reg = await request.post("/api/auth/register", {
    headers: { "User-Agent": "Inviter's phone" },
    data: { email: inviterEmail, password: PASSWORD, role: "TRADESPERSON", name: "Inviting Pro", acceptTerms: true },
  });
  expect(reg.status()).toBe(202);
  const verifyToken = new URLSearchParams((await mailLink(request, inviterEmail, "verify-email")).split("?")[1]).get("token");
  expect((await request.post("/api/auth/verify-email", { data: { token: verifyToken } })).status()).toBe(200);
  const inviter = { email: inviterEmail };
  await login(page, inviter.email);
  await page.goto("/settings");
  const card = page.getByRole("region", { name: "Invite friends" });
  await card.getByRole("button", { name: "Create my invite link" }).click();
  const linkBox = card.getByLabel(/Your invite link/);
  await expect(linkBox).toHaveValue(/\/register\?ref=[A-Z0-9]{8}$/);
  const link = await linkBox.inputValue();
  await expect(card.getByRole("link", { name: "Share on WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=.*register%3Fref%3D/);

  // The friend opens the link in their own browser and signs up.
  const friendCtx = await browser.newContext();
  const friend = await friendCtx.newPage();
  const email = uniqueEmail("friend");
  await friend.goto(new URL(link).pathname + new URL(link).search);
  await expect(friend.getByText("A friend invited you to FixLocal. Welcome!")).toBeVisible();
  await friend.getByRole("button", { name: /^Client/ }).click();
  await friend.getByLabel("Full name").fill("Ravi Friend");
  await friend.getByLabel("Email").fill(email);
  await friend.getByLabel("Password").fill(PASSWORD);
  await friend.getByRole("checkbox", { name: /agree to the Terms/ }).check();
  await friend.getByRole("button", { name: "Create account" }).click();
  await expect(friend.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  const token = new URLSearchParams((await mailLink(request, email, "verify-email")).split("?")[1]).get("token");
  expect((await request.post("/api/auth/verify-email", { data: { token } })).status()).toBe(200);
  await friendCtx.close();

  await page.reload();
  const people = card.getByRole("list", { name: "People you invited" });
  await expect(people).toContainText("Ravi");
  await expect(people).toContainText("Email confirmed");
  await expect(people).not.toContainText(email);

  // The friend's first job is confirmed: both get ₹100 FixLocal credit.
  const friendApi = await apiLogin(request, email);
  const worker = await apiLogin(request, SEEDED.pro2);
  const { job } = await awardedJob(request, friendApi, worker, 1500);
  await apiCall(request, worker, "post", `/api/jobs/${job.id}/start`);
  await apiCall(request, worker, "post", `/api/jobs/${job.id}/mark-done`);
  await apiCall(request, friendApi, "post", `/api/jobs/${job.id}/confirm`);
  await page.reload();
  await expect(people).toContainText("₹100 earned");
  const credit = page.getByRole("region", { name: "FixLocal credit" });
  await expect(credit).toContainText("Balance: ₹100");
  await expect(credit.getByRole("list", { name: "Credit history" })).toContainText("Referral reward");
  await expect(credit).toContainText("added to your next payout");
  const axe = await new AxeBuilder({ page }).include("[aria-labelledby=invite-title]").include("#credit").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test("install banner appears when the browser offers install, prompts once, and stays dismissed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Install app" })).toHaveCount(0);
  const fire = () =>
    page.evaluate(() => {
      const w = window as unknown as { __prompted: number };
      w.__prompted = 0;
      const ev = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: async () => {
          w.__prompted++;
        },
        userChoice: Promise.resolve({ outcome: "dismissed" }),
      });
      window.dispatchEvent(ev);
    });
  await fire();
  const banner = page.getByRole("region", { name: "Install app" });
  await expect(banner).toBeVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await banner.getByRole("button", { name: "Install app" }).click();
  expect(await page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)).toBe(1);
  await expect(banner).toHaveCount(0); // the event is single-use

  await page.reload();
  await fire();
  await banner.getByRole("button", { name: /Not now/ }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await fire();
  await expect(page.getByRole("region", { name: "Install app" })).toHaveCount(0);
});

test("pro profile can be shared on WhatsApp or copied", async ({ page, request, context }) => {
  const pro = await apiLogin(request, SEEDED.pro);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/pros/${pro.id}`);
  const wa = page.getByRole("link", { name: "Share on WhatsApp" });
  await expect(wa).toHaveAttribute("href", new RegExp(`^https://wa\\.me/\\?text=.*%2Fpros%2F${pro.id}$`));
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText("Link copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/pros/${pro.id}$`));
});

test("Hindi toggle translates the core pages, persists, and stays accessible", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /View in Hindi/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("काम पोस्ट करें।");
  await expect(page.getByRole("link", { name: "लॉग इन" })).toBeVisible();
  for (const path of ["/", "/login", "/register"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(axe.violations.map((v) => `${path}@${width}: ${v.id}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "फिर से स्वागत है" })).toBeVisible();
  await page.getByLabel("ईमेल").fill(SEEDED.client);
  await page.getByLabel("पासवर्ड", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "साइन इन" }).click();
  // Navigation landmarks are named in the page language too ("मुख्य" = Primary).
  await expect(page.getByRole("navigation", { name: /मुख्य/ }).getByRole("link", { name: "मेरे काम" }).filter({ visible: true }).first()).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("radio", { name: "English" }).check();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-IN");
  await expect(page.getByRole("navigation", { name: /primary/i }).getByRole("link", { name: "My jobs" }).filter({ visible: true }).first()).toBeVisible();
});
