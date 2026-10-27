import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { apiCall, apiLogin, awardedJob, blockMapTiles, login, postJob, registerViaApi, SEEDED, type ApiUser } from "./fixtures";

/** WCAG A/AA via axe plus the 390 px reflow check. */
async function audit(page: Page, name: string) {
  await page.waitForTimeout(400);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude(".leaflet-container").analyze();
  const found = result.violations.map((v) => `${name}: ${v.id} ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (wide) found.push(`${name}: sideways scroll`);
  return found;
}

for (const size of [
  { name: "desktop", viewport: { width: 1280, height: 900 } },
  { name: "mobile", viewport: { width: 390, height: 844 } },
]) {
  test(`an urgent job: pros filter for it, ask a question, and the client answers for everyone (${size.name})`, async ({ page, browser, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size.viewport);
    await blockMapTiles(page);
    const client = (await registerViaApi(request, "HOMEOWNER", "Urgent Client")) as ApiUser;
    const title = `E2E burst pipe ${Date.now().toString(36)}`;
    const job = await postJob(request, client, { title, urgent: true });

    // The pro finds it with "Urgent only" and sees the badge.
    await login(page, SEEDED.pro2);
    await page.goto("/professional");
    await page.getByRole("button", { name: "Urgent only" }).click();
    await expect(page.getByRole("button", { name: "Urgent only" })).toHaveAttribute("aria-pressed", "true");
    const card = page.getByRole("link", { name: new RegExp(title) });
    await expect(card).toBeVisible();
    await expect(card.getByTestId("urgent-badge")).toBeVisible();
    const found: string[] = [];
    found.push(...(await audit(page, "browse urgent")));

    // Ask: contact details are refused, a real question goes through.
    await card.click();
    const qa = page.getByRole("region", { name: "Questions about this job" });
    await qa.scrollIntoViewIfNeeded();
    await qa.getByLabel("Ask a question").fill("Call me on 98450 12345");
    await qa.getByRole("button", { name: "Send question" }).click();
    await expect(qa.getByRole("alert")).toContainText("Please don't share phone numbers");
    await qa.getByLabel("Ask a question").fill("Is the leak in the wall or under the sink?");
    await qa.getByRole("button", { name: "Send question" }).click();
    await expect(qa.getByTestId("job-question")).toContainText("You asked");
    await expect(qa.getByText("Waiting for the client's answer.")).toBeVisible();
    found.push(...(await audit(page, "pro job page with question")));

    // The client sees who asked and answers.
    const ctx = await browser.newContext({ viewport: size.viewport });
    const clientPage = await ctx.newPage();
    await login(clientPage, client.email);
    await clientPage.goto(`/client/jobs/${job.id}`);
    await expect(clientPage.getByTestId("urgent-badge").first()).toBeVisible();
    await expect(clientPage.getByTestId("job-expiry")).toContainText("Listed until");
    const cqa = clientPage.getByRole("region", { name: "Questions about this job" });
    await cqa.scrollIntoViewIfNeeded();
    await expect(cqa.getByTestId("job-question")).toContainText("Is the leak in the wall");
    await cqa.getByLabel("Your answer").fill("Inside the wall, about a foot above the sink.");
    await cqa.getByRole("button", { name: "Answer", exact: true }).click();
    await expect(cqa.getByRole("status")).toContainText("Answer posted");
    found.push(...(await audit(clientPage, "client job page with Q&A")));
    await ctx.close();

    // Another pro reads the answer without the asker's name.
    const other = await apiLogin(request, SEEDED.pro);
    const seen = await apiCall<{ questions: { answer: string; askerName: string | null }[] }>(request, other, "get", `/api/jobs/${job.id}/questions`);
    expect(seen.questions[0]).toMatchObject({ answer: "Inside the wall, about a foot above the sink.", askerName: null });
    await page.reload();
    await expect(page.getByText("Inside the wall, about a foot above the sink.")).toBeVisible();
    expect(found).toEqual([]);
  });
}

test("a professional replies publicly to a review", async ({ page, request }) => {
  test.setTimeout(90_000);
  const client = (await registerViaApi(request, "HOMEOWNER", "Reviewing Client")) as ApiUser;
  const pro = await apiLogin(request, SEEDED.pro2);
  const { job } = await awardedJob(request, client, pro, 1800);
  await apiCall(request, pro, "post", `/api/jobs/${job.id}/start`);
  await apiCall(request, pro, "post", `/api/jobs/${job.id}/mark-done`);
  const confirm = await request.post(`/api/jobs/${job.id}/confirm`, {
    headers: { Authorization: `Bearer ${client.token}`, "Idempotency-Key": `e2e-confirm-${job.id}` },
  });
  expect(confirm.ok(), await confirm.text()).toBe(true);
  const comment = `Good work but arrived late ${Date.now().toString(36)}`;
  await apiCall(request, client, "post", "/api/reviews", { jobId: job.id, rating: 4, comment });

  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, SEEDED.pro2);
  await page.goto(`/pros/${pro.id}`);
  const item = page.getByRole("listitem").filter({ hasText: comment });
  await item.getByRole("button", { name: "Reply publicly" }).click();
  await item.getByLabel("Your public reply").fill("Thank you! Sorry for the delay, traffic on Outer Ring Road.");
  await item.getByRole("button", { name: "Post reply" }).click();
  await expect(item.getByTestId("review-reply")).toContainText("traffic on Outer Ring Road");
  expect(await audit(page, "pro profile with reply")).toEqual([]);

  // The client sees it too.
  // Fresh token: e2e access tokens last 20 s.
  const again = await apiLogin(request, client.email);
  const seen = await apiCall<{ reviews: { comment: string; reply: string | null }[] }>(request, again, "get", `/api/profile/user/${pro.id}`);
  expect(seen.reviews.find((r) => r.comment === comment)?.reply).toContain("Outer Ring Road");
});

test("an office client adds a GSTIN that shows on the payment summary", async ({ page, request }) => {
  test.setTimeout(90_000);
  const client = (await registerViaApi(request, "HOMEOWNER", "Office Client")) as ApiUser;
  const pro = await apiLogin(request, SEEDED.pro2);
  const { job } = await awardedJob(request, client, pro, 2200);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, client.email);
  await page.goto("/settings");
  const card = page.getByRole("region", { name: "Business & GST details" });
  await card.scrollIntoViewIfNeeded();
  await card.getByLabel("Business name").fill("Acme Interiors LLP");
  await card.getByLabel("GSTIN").fill("27AAPFU0939F1ZX");
  await expect(card.getByText("Enter a valid 15-character GSTIN")).toBeVisible();
  await expect(card.getByRole("button", { name: "Save business details" })).toBeDisabled();
  await card.getByLabel("GSTIN").fill("27aapfu0939f1zv");
  await card.getByRole("button", { name: "Save business details" }).click();
  await expect(card.getByRole("status")).toContainText("Saved.");
  await expect(card.getByLabel("GSTIN")).toHaveValue("27AAPFU0939F1ZV");
  expect(await audit(page, "settings business card")).toEqual([]);

  const proAgain = await apiLogin(request, SEEDED.pro2); // e2e access tokens last 20 s
  const pay = await apiCall<{ parties: { homeowner: { businessName: string; gstin: string } } }>(request, proAgain, "get", `/api/jobs/${job.id}/payments`);
  expect(pay.parties.homeowner).toMatchObject({ businessName: "Acme Interiors LLP", gstin: "27AAPFU0939F1ZV" });
});
