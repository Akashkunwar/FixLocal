import { expect, test } from "@playwright/test";
import { apiCall, apiLogin, awardedJob, login, pdfBytes, pngBytes, registerViaApi, SEEDED } from "./fixtures";

type Notification = { type: string; title: string; createdAt: string };

test("dispute with evidence while awaiting confirmation, resolved for the client with a refund (journey 8)", async ({
  page,
  browser,
  request,
}) => {
  const client = await apiLogin(request, SEEDED.client);
  const pro = await apiLogin(request, SEEDED.pro);
  const { job } = await awardedJob(request, client, pro, 5000);
  await apiCall(request, pro, "post", `/api/jobs/${job.id}/start`);
  await apiCall(request, pro, "post", `/api/jobs/${job.id}/mark-done`);

  await login(page, SEEDED.client);
  await page.goto(`/client/jobs/${job.id}`);
  await page.getByRole("button", { name: "Open dispute" }).click();
  const reason = `Tap still leaks after the visit ${Date.now().toString(36)}`;
  await page.getByLabel("Why are you disputing?").fill(reason);
  await page.getByLabel(/Evidence/).setInputFiles([
    { name: "leak.png", mimeType: "image/png", buffer: pngBytes(6) },
    { name: "receipt.pdf", mimeType: "application/pdf", buffer: pdfBytes() },
  ]);
  await page.getByRole("button", { name: "Submit dispute" }).click();
  await expect(page.getByText("Dispute opened with evidence")).toBeVisible();

  const admin = await (await browser.newContext()).newPage();
  await login(admin, SEEDED.admin);
  await admin.goto("/admin/disputes");
  const card = admin.locator("li", { hasText: reason });
  await expect(card.getByRole("img", { name: "Evidence" })).toBeVisible();
  await expect(card.getByRole("link", { name: "View PDF" })).toHaveAttribute("href", /\/api\/files\/.+\?exp=/);
  await card.getByLabel("Resolution notes").fill("Refund the client; work incomplete.");
  await card.getByRole("button", { name: "Favor client" }).click();
  await expect(admin.getByText(/Dispute resolved · job is now cancelled/)).toBeVisible();

  const pay = await apiCall<{ milestones: { status: string }[] }>(request, client, "get", `/api/jobs/${job.id}/payments`);
  expect(pay.milestones.every((m) => m.status === "refunded")).toBe(true);
  for (const who of [client, pro]) {
    const { notifications } = await apiCall<{ notifications: Notification[] }>(request, who, "get", "/api/notifications");
    expect(notifications.some((n) => n.title === "Dispute resolved")).toBe(true);
  }
});

test("admin: stats, search and suspend (kicks the user out), force-cancel, audit rollback, match page (journey 9)", async ({
  page,
  browser,
  request,
}) => {
  // A client who is signed in elsewhere.
  const victim = await registerViaApi(request, "HOMEOWNER", "Soon Suspended");
  const victimPage = await (await browser.newContext()).newPage();
  await login(victimPage, victim.email);
  await expect(victimPage).toHaveURL(/\/client/);

  await login(page, SEEDED.admin);
  await expect(page.getByText("Total users")).toBeVisible();
  await expect(page.getByText("Awaiting confirmation")).toBeVisible();
  await expect(page.getByText("Open reports")).toBeVisible();

  // Search and suspend.
  await page.goto("/admin/users");
  await page.getByPlaceholder("Search name, email, phone…").fill(victim.email);
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/q=/);
  const row = page.locator("li", { hasText: victim.email });
  await expect(row).toHaveCount(1);
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Suspend" }).click();
  await expect(row.getByRole("button", { name: "Unsuspend" })).toBeVisible();

  // The suspended user's very next request signs them out.
  await victimPage.getByRole("link", { name: "Post a job" }).first().click();
  await expect(victimPage).toHaveURL(/\/login/);

  // Force-cancel an awarded job: refund and notify.
  const client = await apiLogin(request, SEEDED.client2);
  const pro = await apiLogin(request, SEEDED.pro2);
  const { job } = await awardedJob(request, client, pro, 2500);
  await page.goto("/admin/jobs");
  page.once("dialog", (d) => d.accept("Duplicate booking"));
  await page.locator("li", { hasText: job.title }).getByRole("button", { name: "Force cancel" }).click();
  await expect(page.getByText("Job cancelled (was awarded)")).toBeVisible();
  const pay = await apiCall<{ milestones: { status: string }[] }>(request, client, "get", `/api/jobs/${job.id}/payments`);
  expect(pay.milestones.every((m) => m.status === "refunded")).toBe(true);
  const { notifications } = await apiCall<{ notifications: { body: string }[] }>(request, pro, "get", "/api/notifications");
  expect(notifications.some((n) => n.body?.includes("Duplicate booking"))).toBe(true);

  // Change weights and the best-value blend, then roll both back from the audit log.
  await page.goto("/admin/match");
  await expect(page.getByRole("heading", { name: "Match score weights" })).toBeVisible();
  await page.getByRole("button", { name: /^Speed-biased/ }).click();
  await expect(page.getByRole("spinbutton", { name: "Skills (sk)" })).not.toHaveValue("35");
  await page.getByRole("button", { name: /^Match-heavy/ }).click();
  await expect(page.getByRole("spinbutton", { name: "Match %" })).toHaveValue("70");
  await page.goto("/admin/audit");
  await page.getByRole("button", { name: "Rollback weights + heat" }).first().click();
  await expect(page.getByText(/rolled back/i).first()).toBeVisible();
  await page.getByRole("button", { name: "Rollback blend" }).first().click();
  await expect(page.getByText(/blend rolled back/i).first()).toBeVisible();
});
