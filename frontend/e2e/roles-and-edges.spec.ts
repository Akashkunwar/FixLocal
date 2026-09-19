import { expect, test } from "@playwright/test";
import { apiCall, apiLogin, login, logout, pngBytes, postJob, registerViaApi, SEEDED } from "./fixtures";

/** Checks ported from the legacy e2e-auth / e2e-admin / e2e-tradesperson / e2e-homeowner scripts. */

test("each role is sent back to its own dashboard from another role's pages", async ({ page }) => {
  const cases = [
    { who: SEEDED.admin, home: /\/admin$/, forbidden: ["/client", "/professional/my-jobs"] },
    { who: SEEDED.client, home: /\/client$/, forbidden: ["/admin", "/professional"] },
    { who: SEEDED.pro, home: /\/professional$/, forbidden: ["/admin/users", "/client/jobs/new"] },
  ];
  for (const c of cases) {
    await login(page, c.who);
    await expect(page).toHaveURL(c.home);
    for (const path of c.forbidden) {
      await page.goto(path);
      await expect(page).toHaveURL(c.home);
    }
    await logout(page);
  }
});

test("a pending professional is told why they can't bid yet", async ({ page, request }) => {
  const pending = await registerViaApi(request, "TRADESPERSON", "Pending Pro");
  await login(page, pending.email);
  await page.goto("/professional");
  await expect(page.getByText("Your account is waiting for admin verification.")).toBeVisible();
  await expect(page.getByRole("link", { name: /upload a licence or ID/ })).toHaveAttribute("href", "/professional/profile");
  // A verified pro doesn't see it.
  await logout(page);
  await login(page, SEEDED.pro);
  await expect(page.getByText(/waiting for admin verification/)).toHaveCount(0);
});

test("a professional edits their portfolio and the changes persist", async ({ page, request }) => {
  const p = await registerViaApi(request, "TRADESPERSON", "Portfolio Pro");
  await login(page, p.email);
  await page.goto("/professional/profile");
  await page.getByLabel("Bio").fill("Licensed plumber, 8 years, same-day callouts.");
  await page.getByLabel("City").fill("Mysuru");
  await page.getByLabel("Years experience").fill("8");
  await page.getByLabel("Hourly rate min (₹)").fill("400");
  await page.getByLabel("Hourly rate max (₹)").fill("900");
  await page.getByRole("button", { name: "Save portfolio" }).click();
  await expect(page.getByText("Portfolio updated")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Bio")).toHaveValue("Licensed plumber, 8 years, same-day callouts.");
  await expect(page.getByLabel("City")).toHaveValue("Mysuru");
  await expect(page.getByLabel("Hourly rate max (₹)")).toHaveValue("900");
  const { profile } = await apiCall<{ profile: { yearsExperience: number } }>(request, p, "get", "/api/profile");
  expect(profile.yearsExperience).toBe(8);
});

test("a case study uses photos from the pro's own gallery", async ({ page, request }) => {
  const p = await registerViaApi(request, "TRADESPERSON", "Case Study Pro");
  await login(page, p.email);
  await page.goto("/professional/profile");
  await expect(page.getByRole("combobox", { name: "Before photo" })).toBeDisabled();
  await page.locator('input[type="file"][accept^="image"][multiple]').setInputFiles({
    name: "work.png",
    mimeType: "image/png",
    buffer: pngBytes(7),
  });
  await expect(page.getByText("Gallery photos added")).toBeVisible();
  await page.getByLabel("Case study title").fill("Bathroom regrout");
  await page.getByRole("combobox", { name: "Before photo" }).selectOption({ label: "Gallery photo 1" });
  await page.getByRole("button", { name: "Add case study" }).click();
  await page.getByRole("button", { name: "Save portfolio" }).click();
  await expect(page.getByText("Portfolio updated")).toBeVisible();
  const { profile } = await apiCall<{ profile: { caseStudies: { title: string; beforeUrl?: string }[] } }>(
    request,
    p,
    "get",
    "/api/profile"
  );
  expect(profile.caseStudies[0]).toMatchObject({ title: "Bathroom regrout", beforeUrl: expect.stringMatching(/^\/api\/files\//) });
});

test("a professional withdraws a bid", async ({ page, request }) => {
  const client = await apiLogin(request, SEEDED.client2);
  const pro = await apiLogin(request, SEEDED.pro2);
  const job = await postJob(request, client);
  const { bid } = await apiCall<{ bid: { id: string } }>(request, pro, "post", `/api/jobs/${job.id}/bids`, { amount: 1700 });

  await login(page, SEEDED.pro2);
  await page.goto(`/professional/jobs/${job.id}`);
  await page.getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByText("Bid withdrawn")).toBeVisible();
  const { bids } = await apiCall<{ bids: { id: string; status: string }[] }>(request, client, "get", `/api/jobs/${job.id}/bids`);
  expect(bids.find((b) => b.id === bid.id)?.status).toBe("withdrawn");
});

test("posting a job shows the server's error and keeps the draft", async ({ page }) => {
  await login(page, SEEDED.client);
  await page.route("**/api/jobs", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ message: "Budget is outside the allowed range", code: "VALIDATION" }),
        })
      : route.continue()
  );
  await page.goto("/client/jobs/new");
  await page.getByLabel("Title").fill("Leaky geyser valve");
  await page.getByLabel("Description").fill("Pressure valve drips constantly; needs replacing.");
  await page.getByRole("button", { name: /Plumbing/ }).first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Post job" }).click();
  await expect(page.getByText("Budget is outside the allowed range")).toBeVisible();
  await expect(page).toHaveURL(/\/client\/jobs\/new$/);
  await page.reload();
  await expect(page.getByLabel("Title")).toHaveValue("Leaky geyser valve");
});
