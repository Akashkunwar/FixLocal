import { expect, test } from "@playwright/test";
import { apiCall, apiLogin, awardedJob, login, postJob, SEEDED } from "./fixtures";

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
  await page.getByRole("button", { name: "Save alert" }).click();
  const card = page.getByRole("listitem").filter({ hasText: "E2E electrical alert" });
  await expect(card).toContainText("Electrical · Bengaluru");

  const title = `E2E alert job ${Date.now().toString(36)}`;
  const job = await postJob(request, client, { title, category: "electrical" });
  await postJob(request, client, { title: `${title} plumbing`, category: "plumbing" });
  const { notifications } = await apiCall<{ notifications: Notif[] }>(request, pro, "get", "/api/notifications");
  const hits = notifications.filter((n) => n.type === "job_alert" && n.title.includes(title));
  expect(hits).toHaveLength(1);
  expect(hits[0].link).toBe(`/professional/jobs/${job.id}`);

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
