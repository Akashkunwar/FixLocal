import { expect, test } from "@playwright/test";
import { apiCall, apiLogin, awardedJob, login, pngBytes, postJob, SEEDED } from "./fixtures";

test("schedule: pro proposes, client accepts, calendar links and visit prep appear (journey 5)", async ({ page, browser, request }) => {
  const client = await apiLogin(request, SEEDED.client);
  const pro = await apiLogin(request, SEEDED.pro);
  const { job } = await awardedJob(request, client, pro);

  const proCtx = await browser.newContext();
  const proPage = await proCtx.newPage();
  await login(proPage, SEEDED.pro);
  await proPage.goto(`/professional/jobs/${job.id}`);
  await proPage.getByRole("button", { name: "Propose time" }).click();
  await proPage.getByLabel("Start").fill("2030-06-10T09:30");
  await proPage.getByLabel("End").fill("2030-06-10T11:30");
  await proPage.getByPlaceholder("e.g. morning slot, bring ladder").fill("Morning slot");
  await proPage.locator("form", { has: proPage.locator("#schedule-start") }).getByRole("button", { name: "Send proposal" }).click();
  await expect(proPage.getByText("Proposed visit")).toBeVisible();
  await proCtx.close();

  await login(page, SEEDED.client);
  await page.goto(`/client/jobs/${job.id}`);
  await expect(page.getByText("Morning slot")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Visit prep" })).toBeVisible();
  await page.getByRole("button", { name: "Accept time" }).click();
  await expect(page.getByText("Confirmed visit")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download .ics" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Google Calendar" })).toHaveAttribute("href", /calendar\.google\.com/);
  await expect(page.getByRole("link", { name: "Outlook" })).toHaveAttribute("href", /outlook/);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .ics" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.ics$/);
});

test("chat: each pro has a private thread, attachments work, and messages arrive live or by polling (journey 6)", async ({
  page,
  browser,
  request,
}) => {
  const client = await apiLogin(request, SEEDED.client);
  const pro = await apiLogin(request, SEEDED.pro);
  const pro2 = await apiLogin(request, SEEDED.pro2);
  const job = await postJob(request, client);
  await apiCall(request, pro, "post", `/api/jobs/${job.id}/bids`, { amount: 2000 });
  await apiCall(request, pro2, "post", `/api/jobs/${job.id}/bids`, { amount: 2100 });

  // Pro 1 writes and attaches a photo from the UI.
  const p1 = await (await browser.newContext()).newPage();
  await login(p1, SEEDED.pro);
  await p1.goto(`/professional/jobs/${job.id}`);
  await p1.getByRole("textbox", { name: "Message", exact: true }).fill("Hello from Arjun");
  await p1.getByRole("button", { name: "Send" }).click();
  await expect(p1.getByText("Hello from Arjun")).toBeVisible();
  await p1.locator('input[type="file"][multiple]').setInputFiles({ name: "leak.png", mimeType: "image/png", buffer: pngBytes(3) });
  await p1.getByRole("textbox", { name: "Message", exact: true }).fill("Photo of the fitting");
  await p1.getByRole("button", { name: "Send" }).click();
  await expect(p1.locator('img[src*="/api/files/"]').first()).toBeVisible();

  // Pro 2 sees only their own (empty) conversation.
  const p2 = await (await browser.newContext()).newPage();
  await login(p2, SEEDED.pro2);
  await p2.goto(`/professional/jobs/${job.id}`);
  await expect(p2.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
  await expect(p2.getByText("Hello from Arjun")).toHaveCount(0);
  await p2.getByRole("textbox", { name: "Message", exact: true }).fill("Sneha here");
  await p2.getByRole("button", { name: "Send" }).click();
  await expect(p2.getByText("Sneha here")).toBeVisible();

  // The client switches between the two threads.
  await login(page, SEEDED.client);
  await page.goto(`/client/jobs/${job.id}`);
  const tabs = page.getByRole("tablist", { name: "Conversations" });
  await tabs.getByRole("tab", { name: /Arjun/ }).click();
  await expect(page.getByText("Hello from Arjun")).toBeVisible();
  await expect(page.getByText("Sneha here")).toHaveCount(0);
  await tabs.getByRole("tab", { name: /Sneha/ }).click();
  await expect(page.getByText("Sneha here")).toBeVisible();
  await expect(page.getByText("Hello from Arjun")).toHaveCount(0);

  // Live: a new message from pro 2 shows up without a reload.
  await apiCall(request, pro2, "post", `/api/messages/${job.id}`, { body: "Live update check" });
  await expect(page.getByText("Live update check")).toBeVisible({ timeout: 8_000 });

  // With the stream blocked, polling still delivers messages.
  const polled = await (await browser.newContext()).newPage();
  await polled.route(/\/stream\?/, (route) => route.abort());
  await login(polled, SEEDED.pro2);
  await polled.goto(`/professional/jobs/${job.id}`);
  await expect(polled.getByText("Sneha here")).toBeVisible();
  await apiCall(request, client, "post", `/api/messages/${job.id}?pro=${pro2.id}`, { body: "Reply via polling" });
  await expect(polled.getByText("Reply via polling")).toBeVisible({ timeout: 15_000 });
});

test("completion: start, photos, mark done, confirm, escrow release, two-way reviews, invoice (journey 7)", async ({
  page,
  browser,
  request,
}) => {
  const client = await apiLogin(request, SEEDED.client);
  const pro = await apiLogin(request, SEEDED.pro);
  const { job } = await awardedJob(request, client, pro, 4000);

  const proPage = await (await browser.newContext()).newPage();
  await login(proPage, SEEDED.pro);
  await proPage.goto(`/professional/jobs/${job.id}`);
  await proPage.getByRole("button", { name: "Start work" }).click();
  await expect(proPage.getByRole("button", { name: "Mark work done" })).toBeVisible();
  await proPage.getByLabel("Before photos").setInputFiles({ name: "b.png", mimeType: "image/png", buffer: pngBytes(4) });
  await proPage.getByLabel("After photos").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: pngBytes(5) });
  await proPage.getByRole("button", { name: "Upload photos" }).click();
  await expect(proPage.locator('img[src*="/api/files/"]')).toHaveCount(2);
  await proPage.getByRole("button", { name: "Mark work done" }).click();
  await expect(proPage.getByText(/waiting for the client|pending confirmation|Waiting for/i).first()).toBeVisible();

  await login(page, SEEDED.client);
  await page.goto(`/client/jobs/${job.id}`);
  await expect(page.getByText("The professional marked this job as done")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Confirm work is complete" }).click();
  await expect(page.getByText(/remaining payment milestone\(s\) released|Job marked completed/)).toBeVisible();

  const pay = await apiCall<{ milestones: { status: string }[] }>(request, client, "get", `/api/jobs/${job.id}/payments`);
  expect(pay.milestones.map((m) => m.status)).toEqual(["released", "released", "released"]);

  // Client reviews the pro.
  await page.getByRole("radio", { name: "4 stars" }).click();
  await page.getByLabel("Review comment").fill("Quick and tidy.");
  await page.getByRole("button", { name: "Submit review" }).click();
  await expect(page.getByText("Quick and tidy.")).toBeVisible();

  // Pro reviews the client.
  await proPage.reload();
  await proPage.getByRole("radio", { name: "5 stars" }).click();
  await proPage.getByLabel("Review comment").fill("Clear brief, paid promptly.");
  await proPage.getByRole("button", { name: "Submit review" }).click();
  await expect(proPage.getByText("Clear brief, paid promptly.")).toBeVisible();

  // The client sees the pro's rating and can print the invoice.
  await page.reload();
  await expect(page.getByText(/rated working with you 5\/5/)).toBeVisible();
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: /Print/ }).click();
  const invoice = await popup;
  await expect(invoice.getByText(/escrow/i).first()).toBeVisible();
});
