import { expect, test } from "@playwright/test";
import { apiCall, apiLogin, awardedJob, login, PASSWORD, registerViaApi, SEEDED, uniqueEmail } from "./fixtures";

test("legal pages, footer links and a real 404", async ({ page }) => {
  await page.goto("/");
  const legal = page.getByRole("navigation", { name: "Legal" });
  await legal.getByRole("link", { name: "Terms" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeVisible();
  await expect(page.getByText(/payments on FixLocal are simulated/i)).toBeVisible();
  await expect(page).toHaveTitle(/Terms of Service · FixLocal/);
  await page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();

  await page.goto("/definitely-not-a-page");
  await expect(page.getByRole("heading", { name: "We couldn’t find that page" })).toBeVisible();
  await page.getByRole("link", { name: "Go to FixLocal" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("registration needs Terms consent", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Consent Check");
  await page.getByLabel("Email").fill(uniqueEmail("client"));
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Please accept the Terms of Service and Privacy Policy to continue")).toBeVisible();
  await expect(page).toHaveURL(/\/register/);
  await page.getByRole("checkbox", { name: /agree to the Terms/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
});

test("sign-up with an existing email looks exactly like a new sign-up", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Someone Else");
  await page.getByLabel("Email").fill(SEEDED.client);
  await page.getByLabel("Password").fill("Some-other-pass-1");
  await page.getByRole("checkbox", { name: /agree to the Terms/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  await expect(page.getByText(/already registered/i)).toHaveCount(0);
});

test("client can't release escrow before work starts, and can cancel the booking with a refund", async ({ page, browser, request }) => {
  const client = await apiLogin(request, SEEDED.client2);
  const pro = await apiLogin(request, SEEDED.pro2);
  const { job } = await awardedJob(request, client, pro, 2400);

  await login(page, SEEDED.client2);
  await page.goto(`/client/jobs/${job.id}`);
  await expect(page.getByTestId("awaiting-start")).toBeVisible();
  await expect(page.getByRole("button", { name: /Mark completed|Confirm work is complete/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Cancel booking" }).click();
  await page.getByLabel(/Reason/).fill("Plans changed");
  await page.getByRole("button", { name: "Yes, cancel booking" }).click();
  // Nothing had been released yet, so the whole ₹2,400 goes back.
  await expect(page.getByText(/₹2,400 held in escrow was refunded/)).toBeVisible();
  await expect(page.getByTestId("cancellation-note")).toContainText("cancelled by the client");

  const proCtx = await browser.newContext();
  const proPage = await proCtx.newPage();
  await login(proPage, SEEDED.pro2);
  await proPage.goto(`/professional/jobs/${job.id}`);
  await expect(proPage.getByTestId("cancellation-note")).toContainText("Plans changed");
  await proCtx.close();
});

test("pro can call off a booking before starting", async ({ page, request }) => {
  const client = await apiLogin(request, SEEDED.client2);
  const pro = await apiLogin(request, SEEDED.pro2);
  const { job } = await awardedJob(request, client, pro, 1500);
  await login(page, SEEDED.pro2);
  await page.goto(`/professional/jobs/${job.id}`);
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await page.getByRole("button", { name: "Yes, cancel booking" }).click();
  await expect(page.getByTestId("cancellation-note")).toContainText("cancelled by the professional");
  const after = await apiCall<{ job: { status: string } }>(request, client, "get", `/api/jobs/${job.id}`);
  expect(after.job.status).toBe("cancelled");
});

test("block a pro, see them in Settings, unblock; download my data", async ({ page, request }) => {
  const fresh = await registerViaApi(request, "HOMEOWNER", "Blocker Client");
  const pro = await apiLogin(request, SEEDED.pro);
  await login(page, fresh.email);

  await page.goto(`/pros/${pro.id}`);
  await page.getByRole("button", { name: "Block" }).click();
  await page.getByRole("group", { name: /Block/ }).getByRole("button", { name: "Block" }).click();
  await expect(page.getByText("Blocked · manage in Settings")).toBeVisible();

  await page.goto("/settings");
  const list = page.getByTestId("blocked-list");
  await expect(list).toBeVisible();
  await list.getByRole("button", { name: /Unblock/ }).first().click();
  await expect(page.getByTestId("no-blocks")).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download my data/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^fixlocal-data-\d{4}-\d{2}-\d{2}\.json$/);
});

test("a pro's public profile opens without an account, with its own title and description", async ({ page, request }) => {
  const pro = await apiLogin(request, SEEDED.pro);
  await page.goto(`/pros/${pro.id}`);
  await expect(page).toHaveURL(new RegExp(`/pros/${pro.id}$`));
  await expect(page.getByRole("link", { name: "Sign up to get a quote" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  const name = (await page.getByRole("heading", { level: 1 }).textContent())?.trim() || "";
  expect(name.length).toBeGreaterThan(0);
  await expect(page).toHaveTitle(`${name} · FixLocal`);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Verified professional on FixLocal/);
  // Search engines find every verified pro through the pro sitemap.
  const sitemap = await request.get("/sitemap-pros.xml");
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain(`/pros/${pro.id}</loc>`);
});
