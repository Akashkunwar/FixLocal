import { expect, test } from "@playwright/test";
import { apiCall, apiLogin, awardedJob, login, logout, registerViaApi, SEEDED } from "./fixtures";

test("AMC: pro proposes and the client counters; client requests and the pro accepts (journey 12)", async ({ page, browser, request }) => {
  const client = await apiLogin(request, SEEDED.client);
  const pro = await apiLogin(request, SEEDED.pro);
  const first = await awardedJob(request, client, pro, 1800);
  const second = await awardedJob(request, client, pro, 1900);

  const proPage = await (await browser.newContext()).newPage();
  await login(proPage, SEEDED.pro);
  await proPage.goto(`/professional/jobs/${first.job.id}`);
  const proposeForm = proPage.locator("form", { has: proPage.locator("#amc-min") });
  await proposeForm.getByRole("group", { name: "Proposal cadence" }).getByRole("button", { name: "Monthly" }).click();
  await proposeForm.getByLabel("Amount min (₹)").fill("1500");
  await proposeForm.getByRole("button", { name: "Send proposal" }).click();
  await expect(proPage.getByText("Waiting for the client to reply to your proposal.")).toBeVisible();

  await login(page, SEEDED.client);
  await page.goto(`/client/jobs/${first.job.id}`);
  await page.getByRole("button", { name: "Counter cadence" }).click();
  await page.getByRole("button", { name: "Weekly" }).last().click();
  await page.getByRole("button", { name: "Send counter" }).click();
  await expect(page.getByText("Counter cadence sent")).toBeVisible();
  const after = await apiCall<{ job: { amcProposal: { status: string } } }>(request, client, "get", `/api/jobs/${first.job.id}`);
  expect(after.job.amcProposal.status).toBe("countered");

  // Client-initiated request, accepted by the pro.
  await page.goto(`/client/jobs/${second.job.id}`);
  const requestForm = page.locator("form", { has: page.locator("#amc-req-min") });
  await requestForm.getByRole("group", { name: "Proposal cadence" }).getByRole("button", { name: "AMC" }).click();
  await requestForm.getByLabel("Amount min (₹)").fill("12000");
  await requestForm.getByRole("button", { name: "Request AMC" }).click();
  await expect(page.getByText("Waiting for your professional to reply to this AMC request.")).toBeVisible();

  await proPage.goto(`/professional/jobs/${second.job.id}`);
  await proPage.getByRole("button", { name: "Accept request" }).click();
  await expect(proPage.getByText(/Accepted client AMC request/)).toBeVisible();
  const accepted = await apiCall<{ job: { amcProposal: { status: string } } }>(request, client, "get", `/api/jobs/${second.job.id}`);
  expect(accepted.job.amcProposal.status).toBe("accepted");
});

test("settings: notification toggles, every template kind, and nudge hours persist (journey 13)", async ({ page, browser, request }) => {
  const clientUser = await registerViaApi(request, "HOMEOWNER", "Settings Client");
  await login(page, clientUser.email);
  await page.goto("/settings");

  for (const name of ["Match tips", "Saved pro availability"]) {
    await page.getByRole("switch", { name }).click();
    await expect(page.getByRole("switch", { name })).toHaveAttribute("aria-checked", "false");
  }
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Notification preferences saved")).toBeVisible();

  // Invite templates: add, edit, remove.
  const invite = page.locator("section", { has: page.getByRole("heading", { name: "Invite message templates" }) });
  await invite.getByLabel("Invite template label").fill("Weekend");
  await invite.getByLabel("Invite template body").fill("Can you come this weekend?");
  await invite.getByRole("button", { name: "Add template" }).click();
  await expect(invite.getByText("Can you come this weekend?")).toBeVisible();
  await invite.locator("li", { hasText: "Weekend" }).getByRole("button", { name: "Edit" }).click();
  await invite.getByLabel("Invite template body").fill("Can you come Saturday morning?");
  await invite.getByRole("button", { name: "Save changes" }).click();
  await expect(invite.getByText("Can you come Saturday morning?")).toBeVisible();
  await invite.locator("li", { hasText: "Flexible timing" }).getByRole("button", { name: "Remove" }).click();
  await expect(invite.locator("li", { hasText: "Flexible timing" })).toHaveCount(0);

  const counter = page.locator("section", { has: page.getByRole("heading", { name: "Counter-offer note templates" }) });
  await counter.getByLabel("Note template body").fill("Could you include materials?");
  await counter.getByRole("button", { name: "Add template" }).click();
  await expect(counter.getByText("Could you include materials?")).toBeVisible();

  // Everything survives a reload (it lives on the account, not in this browser).
  await page.reload();
  await expect(page.getByRole("switch", { name: "Match tips" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("switch", { name: "Saved pro availability" })).toHaveAttribute("aria-checked", "false");
  await expect(invite.getByText("Can you come Saturday morning?")).toBeVisible();
  await expect(invite.locator("li", { hasText: "Flexible timing" })).toHaveCount(0);
  const { templates } = await apiCall<{ templates: Record<string, { body: string }[]> }>(request, clientUser, "get", "/api/auth/me/templates");
  expect(templates.invite.map((t) => t.body)).toContain("Can you come Saturday morning?");
  expect(templates.homeownerCounter.map((t) => t.body)).toContain("Could you include materials?");
  const me = await apiCall<{ user: { notificationPrefs: Record<string, boolean> } }>(request, clientUser, "get", "/api/auth/me");
  expect(me.user.notificationPrefs).toMatchObject({ match: false, pro_available: false, message: true });

  // Pro kinds: counter replies, intros, and nudge hours.
  const pro = await registerViaApi(request, "TRADESPERSON", "Settings Pro");
  const proPage = await (await browser.newContext()).newPage();
  await login(proPage, pro.email);
  await proPage.goto("/settings");
  const replies = proPage.locator("section", { has: proPage.getByRole("heading", { name: "Counter-offer reply templates" }) });
  await replies.getByLabel("Reply template body").fill("Best I can do is ₹X.");
  await replies.getByRole("button", { name: "Add template" }).click();
  await expect(replies.getByText("Best I can do is ₹X.")).toBeVisible();
  const intros = proPage.locator("section", { has: proPage.getByRole("heading", { name: "Intro / first-message templates" }) });
  await intros.getByLabel("Intro template body").fill("On my way with tools.");
  await intros.getByRole("button", { name: "Add template" }).click();
  await expect(intros.getByText("On my way with tools.")).toBeVisible();
  await intros.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(intros.getByText("On my way with tools.")).toHaveCount(0);
  await proPage.getByLabel("Nudge after (hours)").fill("12");
  await proPage.getByRole("button", { name: "Save nudge hours" }).click();
  await expect(proPage.getByText("Nudge set to 12h")).toBeVisible();
  await proPage.reload();
  await expect(proPage.getByLabel("Nudge after (hours)")).toHaveValue("12");
  await expect(replies.getByText("Best I can do is ₹X.")).toBeVisible();
});

test("named job templates: save from a completed job, apply, remove (journey 13)", async ({ page, request }) => {
  const client = await apiLogin(request, SEEDED.client2);
  const pro = await apiLogin(request, SEEDED.pro2);
  const { job } = await awardedJob(request, client, pro, 2000);
  await apiCall(request, pro, "post", `/api/jobs/${job.id}/start`);
  await apiCall(request, pro, "post", `/api/jobs/${job.id}/mark-done`);
  const confirm = await request.post(`/api/jobs/${job.id}/confirm`, {
    headers: { Authorization: `Bearer ${client.token}`, "Idempotency-Key": `c-${job.id}` },
  });
  expect(confirm.status()).toBe(200);

  await login(page, SEEDED.client2);
  await page.goto(`/client/jobs/${job.id}`);
  const name = `Tap service ${Date.now().toString(36)}`;
  page.once("dialog", (d) => d.accept(name));
  await page.getByRole("button", { name: "Save as template" }).click();
  await expect(page.getByText(`Saved “${name}” to your job templates`)).toBeVisible();

  await page.goto("/client/jobs/new");
  await expect(page.getByText(name)).toBeVisible();

  await page.goto("/settings");
  const named = page.locator("section", { has: page.getByRole("heading", { name: "Named job templates" }) });
  await named.locator("li", { hasText: name }).getByRole("button", { name: "Remove" }).click();
  await expect(named.getByText(name)).toHaveCount(0);
});

test("session: expired access tokens refresh silently; logout ends the session (journey 14)", async ({ page }) => {
  await login(page, SEEDED.client);
  await expect(page).toHaveURL(/\/client$/);
  const refreshes: number[] = [];
  page.on("response", (r) => {
    if (r.url().endsWith("/api/auth/refresh")) refreshes.push(r.status());
  });

  // The E2E server issues 20-second access tokens.
  await page.waitForTimeout(22_000);
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Shortlist" }).click();
  await expect(page).toHaveURL(/\/client\/favorites$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect.poll(() => refreshes).toContain(200);

  await logout(page);
  await page.goto("/client");
  await expect(page).toHaveURL(/\/login/);
  const res = await page.request.post("/api/auth/refresh");
  expect(res.status()).toBe(401);
});

test.describe("mobile (journey 15)", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test("dashboard, job detail and chat fit a phone screen", async ({ page, request }) => {
    const client = await apiLogin(request, SEEDED.client);
    const pro = await apiLogin(request, SEEDED.pro);
    const { job } = await awardedJob(request, client, pro, 2100);
    await apiCall(request, pro, "post", `/api/messages/${job.id}`, { body: "Mobile hello" });

    await login(page, SEEDED.client);
    const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    await expect(page.getByRole("navigation", { name: "Mobile primary" })).toBeVisible();
    expect(await noSideScroll()).toBe(true);

    await page.goto(`/client/jobs/${job.id}`);
    await expect(page.getByRole("heading", { name: job.title })).toBeVisible();
    await expect(page.getByText("Mobile hello")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
    expect(await noSideScroll()).toBe(true);
  });
});
