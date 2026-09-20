import { expect, test, type Page } from "@playwright/test";
import { apiCall, apiLogin, login, postJob, SEEDED, type ApiUser } from "./fixtures";

type Bid = { id: string; amount: number; quoteAmount?: number; quoteRevision: number };

async function bid(request: Parameters<typeof apiCall>[0], pro: ApiUser, jobId: string, amount: number) {
  const body = await apiCall<{ bid: Bid }>(request, pro, "post", `/api/jobs/${jobId}/bids`, {
    amount,
    quoteAmount: amount,
    quoteNotes: "Parts and labour",
    etaDays: 2,
  });
  return body.bid;
}

/** Accept the next confirm() and capture its text. */
function nextDialog(page: Page) {
  return new Promise<string>((resolve) => {
    page.once("dialog", async (d) => {
      resolve(d.message());
      await d.accept();
    });
  });
}

test("client compares bids, counters, pro revises, client accepts and escrow is split (journey 3)", async ({ page, browser, request }) => {
  const client = await apiLogin(request, SEEDED.client);
  const pro = await apiLogin(request, SEEDED.pro);
  const pro2 = await apiLogin(request, SEEDED.pro2);
  const job = await postJob(request, client);
  const first = await bid(request, pro, job.id, 3000);
  await bid(request, pro2, job.id, 3400);

  await login(page, SEEDED.client);
  await page.goto(`/client/jobs/${job.id}`);
  await expect(page.getByText("Escrow what-if · side-by-side")).toBeVisible();
  await expect(page.getByText("Best value").first()).toBeVisible();

  // Counter-offer with a template chip.
  const card = page.locator(`#bid-${first.id}`);
  await card.getByRole("button", { name: "Request revise" }).click();
  await card.getByPlaceholder("Suggested ₹").fill("2600");
  await card.getByRole("button", { name: "Budget tight" }).click();
  await card.getByRole("button", { name: "Send to pro" }).click();
  await expect(page.getByText("Counter-offer / revise request sent to the pro")).toBeVisible();

  // The pro opens the counter deep link and revises toward the suggestion.
  const proCtx = await browser.newContext();
  const proPage = await proCtx.newPage();
  await login(proPage, SEEDED.pro);
  await proPage.goto(`/professional/jobs/${job.id}?counter=1#bid-form`);
  await expect(proPage.getByText("Client requested a quote revise")).toBeVisible();
  await proPage.getByRole("button", { name: "Revise toward suggestion" }).click();
  await proPage.getByRole("button", { name: "Save revision" }).click();
  await expect(proPage.getByText(/Quote ₹2,?600/)).toBeVisible();
  await proCtx.close();

  // The client is notified with a deep link to the revised bid.
  const { notifications } = await apiCall<{ notifications: { link: string | null; title: string }[] }>(
    request,
    client,
    "get",
    "/api/notifications"
  );
  const revised = notifications.find((n) => n.link?.includes(`bid=${first.id}`));
  expect(revised, JSON.stringify(notifications.slice(0, 5))).toBeTruthy();
  await page.goto(revised!.link!);
  await expect(page.locator(`#bid-${first.id}`)).toBeVisible();

  // Accept: the confirm dialog names the final amount.
  const dialog = nextDialog(page);
  await page.locator(`#bid-${first.id}`).getByRole("button", { name: /Accept/ }).click();
  expect(await dialog).toMatch(/2600/);
  await expect(page.getByText(/Accepted · ₹2600/)).toBeVisible();

  for (const label of ["Deposit", "Progress", "Completion"]) {
    await expect(page.getByText(new RegExp(`\\d\\. ${label}`)).first()).toBeVisible();
  }
  const pay = await apiCall<{ milestones: { label: string; amount: number }[] }>(request, client, "get", `/api/jobs/${job.id}/payments`);
  expect(pay.milestones.map((m) => [m.label, Number(m.amount)])).toEqual([
    ["Deposit", 780],
    ["Progress", 1040],
    ["Completion", 780],
  ]);
});

test("a quote changed after the page loaded is caught before accepting (journey 4)", async ({ page, request }) => {
  const client = await apiLogin(request, SEEDED.client);
  const pro = await apiLogin(request, SEEDED.pro);
  const job = await postJob(request, client);
  const b = await bid(request, pro, job.id, 2000);

  await login(page, SEEDED.client);
  await page.goto(`/client/jobs/${job.id}`);
  await expect(page.locator(`#bid-${b.id}`)).toBeVisible();

  // The pro raises the quote while the client is looking at the old one.
  await apiCall(request, pro, "patch", `/api/bids/${b.id}/quote`, { quoteAmount: 2900 });

  const firstDialog = nextDialog(page);
  await page.locator(`#bid-${b.id}`).getByRole("button", { name: /Accept/ }).click();
  expect(await firstDialog).toMatch(/2000/);
  await expect(page.getByText(/changed their quote to ₹2900/)).toBeVisible();
  const status = await apiCall<{ job: { status: string } }>(request, client, "get", `/api/jobs/${job.id}`);
  expect(status.job.status).toBe("open");

  // A fresh confirm shows the new amount.
  const secondDialog = nextDialog(page);
  await page.locator(`#bid-${b.id}`).getByRole("button", { name: /Accept/ }).click();
  expect(await secondDialog).toMatch(/2900/);
  await expect(page.getByText(/Accepted · ₹2900/)).toBeVisible();
});
