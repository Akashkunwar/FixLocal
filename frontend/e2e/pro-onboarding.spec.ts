import { expect, test } from "@playwright/test";
import { apiCall, apiLogin, login, mailLink, PASSWORD, pdfBytes, postJob, SEEDED, uniqueEmail } from "./fixtures";

test("pro registers, is blocked until verified, then filters, saves a search and bids with a quote PDF (journey 2)", async ({
  page,
  browser,
  request,
}) => {
  const client = await apiLogin(request, SEEDED.client);
  const area = `Whitefield-${Date.now().toString(36)}`;
  const job = await postJob(request, client, { area, budgetMin: 1500, budgetMax: 4000 });

  // Register through the UI and verify the email.
  const email = uniqueEmail("pro");
  const name = `Ravi Pro ${Date.now().toString(36)}`;
  await page.goto("/register?role=TRADESPERSON");
  await page.getByRole("button", { name: /^Professional/ }).click();
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/professional/);
  await page.goto(await mailLink(request, email, "verify-email"));
  await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();

  // Pending: job details are refused.
  await page.goto(`/professional/jobs/${job.id}`);
  await expect(page.getByText(/needs to be verified/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit bid" })).toHaveCount(0);

  // Upload a licence for the admin to review.
  await page.goto("/professional/profile");
  await page.locator('input[type="file"][accept^="application/pdf"]').setInputFiles({
    name: "licence.pdf",
    mimeType: "application/pdf",
    buffer: pdfBytes(),
  });
  await expect(page.getByRole("link", { name: "View uploaded document" })).toBeVisible();

  // Admin verifies the pro.
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, SEEDED.admin);
  await admin.goto("/admin/tradespeople");
  const card = admin.locator("li", { hasText: name });
  await expect(card.getByRole("link", { name: /licence \/ ID document/ })).toBeVisible();
  await card.getByRole("button", { name: "Verify" }).click();
  await expect(admin.locator("li", { hasText: name })).toHaveCount(0);
  await adminCtx.close();

  // Browse with area and budget filters, and save the search.
  await page.goto("/professional");
  await page.getByLabel("Neighborhood").fill(area);
  await page.getByLabel("Minimum budget").fill("1000");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(job.title)).toBeVisible();
  await page.getByLabel("Maximum budget").fill("1000");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(job.title)).toHaveCount(0);
  await page.getByLabel("Maximum budget").fill("");
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "Save search" }).click();
  await expect(page.getByText("Search saved on this device")).toBeVisible();

  // Bid with a visit window and a structured quote plus PDF.
  await page.getByText(job.title).click();
  await expect(page).toHaveURL(new RegExp(`/professional/jobs/${job.id}`));
  await page.getByLabel("Amount (₹)", { exact: true }).fill("2200");
  await page.getByLabel("ETA days").fill("2");
  await page.getByLabel("Proposed visit start (optional)").fill("2030-05-01T10:00");
  await page.getByLabel("Proposed visit end").fill("2030-05-01T12:00");
  await page.getByLabel("Message").fill("Includes new washer and labour.");
  await page.getByLabel("Quote amount (₹)").fill("2200");
  await page.getByLabel("Quote notes").fill("Washer ₹200, labour ₹2000");
  await page.getByLabel("Quote PDF / image").setInputFiles({ name: "quote.pdf", mimeType: "application/pdf", buffer: pdfBytes() });
  await page.getByRole("button", { name: "Submit bid" }).click();
  await expect(page.getByRole("heading", { name: "Your bid" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View quote attachment" })).toBeVisible();

  // The client sees the bid with its visit window.
  const { bids } = await apiCall<{ bids: { amount: number; proposedVisitStart: string; quoteAttachmentUrl: string }[] }>(
    request,
    client,
    "get",
    `/api/jobs/${job.id}/bids`
  );
  const bid = bids.find((b) => Number(b.amount) === 2200)!;
  expect(bid.proposedVisitStart).toBeTruthy();
  expect(bid.quoteAttachmentUrl).toMatch(/\/api\/files\//);
});
