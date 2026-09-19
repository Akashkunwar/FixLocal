import { expect, test } from "@playwright/test";
import { apiCall, apiLogin, login, postJob, SEEDED } from "./fixtures";

test("invites from suggested pros and the shortlist; pro declines from the notification; cooldown and analytics (journey 10)", async ({
  page,
  browser,
  request,
}) => {
  const client = await apiLogin(request, SEEDED.client2);
  const arjun = await apiLogin(request, SEEDED.pro);
  const sneha = await apiLogin(request, SEEDED.pro2);
  const job = await postJob(request, client, { category: "plumbing" });

  const { suggestions: pros } = await apiCall<{ suggestions: { userId: string; name: string }[] }>(
    request,
    client,
    "get",
    `/api/jobs/${job.id}/suggested-pros`
  );
  const suggested = pros.find((p) => p.userId === arjun.id || p.userId === sneha.id);
  expect(suggested, `suggested: ${JSON.stringify(pros.map((p) => p.name))}`).toBeTruthy();
  const invitee = suggested!.userId === arjun.id ? arjun : sneha;
  const other = invitee === arjun ? sneha : arjun;
  const otherName = other === arjun ? "Arjun Patel" : "Sneha Reddy";
  await apiCall(request, client, "post", "/api/favorites", { targetType: "pro", targetId: other.id });

  await login(page, SEEDED.client2);
  await page.goto(`/client/jobs/${job.id}`);

  // Invite from suggested pros.
  const suggestedSection = page.locator("section", { has: page.getByRole("heading", { name: "Suggested pros" }) });
  await suggestedSection.locator("li", { hasText: suggested!.name }).getByRole("button", { name: "Invite" }).click();
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(suggestedSection.locator("li", { hasText: suggested!.name }).getByRole("button", { name: "Invited" })).toBeVisible();

  // Bulk invite from the shortlist.
  const shortlist = page.locator("section", { has: page.getByRole("heading", { name: "Invite from shortlist" }) });
  await shortlist.getByRole("button", { name: "Invite multiple" }).click();
  await shortlist.locator("li", { hasText: otherName }).getByRole("checkbox").check();
  await shortlist.getByRole("button", { name: "Invite 1 from shortlist" }).click();
  await expect
    .poll(async () => {
      const { invites } = await apiCall<{ invites: { tradespersonId: string; source?: string }[] }>(
        request,
        client,
        "get",
        `/api/jobs/${job.id}/invites`
      );
      return invites.map((i) => i.tradespersonId).sort();
    })
    .toEqual([invitee.id, other.id].sort());

  // The invited pro opens the notification deep link and declines with a reason.
  const { notifications } = await apiCall<{ notifications: { link: string | null }[] }>(request, invitee, "get", "/api/notifications");
  const link = notifications.find((n) => n.link?.includes(job.id) && n.link.includes("invite=1"))?.link;
  expect(link).toBeTruthy();
  const proPage = await (await browser.newContext()).newPage();
  await login(proPage, invitee.email);
  await proPage.goto(link!);
  await expect(proPage.getByText("You were invited to bid on this job")).toBeVisible();
  await proPage.getByRole("button", { name: "Decline invite" }).click();
  await proPage.getByRole("button", { name: "Schedule conflict" }).click();
  await proPage.getByRole("button", { name: "Confirm decline" }).click();
  await expect(proPage.getByText("You were invited to bid on this job")).toHaveCount(0);

  // The client sees the cooldown, and the funnel counts the open and the decline.
  await page.reload();
  await expect(suggestedSection.locator("li", { hasText: suggested!.name }).getByRole("button", { name: "Cooldown" })).toBeVisible();
  const analytics = await apiCall<Record<string, number>>(request, client, "get", `/api/jobs/${job.id}/invite-analytics`);
  expect(analytics).toMatchObject({ opened: expect.any(Number), declined: expect.any(Number) });
  expect(analytics.declined).toBeGreaterThanOrEqual(1);
  expect(analytics.opened).toBeGreaterThanOrEqual(1);
});

test("shortlist notes and tags, and Find Pros filters reach the API (journey 11)", async ({ page, request }) => {
  const client = await apiLogin(request, SEEDED.client2);
  const sneha = await apiLogin(request, SEEDED.pro2);
  await request.delete(`/api/favorites?targetType=pro&targetId=${sneha.id}`, { headers: { Authorization: `Bearer ${client.token}` } });

  await login(page, SEEDED.client2);
  await page.goto("/client/pros");
  await expect(page.getByText("Sneha Reddy").first()).toBeVisible();

  // Every advanced filter is sent to the server.
  await page.getByLabel("Reply speed").selectOption("fast_or_better");
  await page.getByLabel("Available this week").check();
  await page.getByLabel("Minimum availability heat").selectOption("25");
  await page.getByLabel("Sort by").selectOption("distance");
  const browse = page.waitForRequest((r) => r.url().includes("/api/profile/browse?"));
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const url = new URL((await browse).url());
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    slaTier: "fast_or_better",
    availableThisWeek: "1",
    minHeat: "25",
    sort: "distance",
  });
  const siteReq = page.waitForRequest((r) => r.url().includes("/api/profile/browse?") && r.url().includes("siteType=office"));
  await page.getByRole("group", { name: "Site type filter" }).getByRole("button", { name: /Office/ }).click();
  await siteReq;

  // Shortlist a pro, then add a note and tags.
  await page.getByLabel("Reply speed").selectOption("");
  await page.getByLabel("Available this week").uncheck();
  await page.getByLabel("Minimum availability heat").selectOption("");
  await page.getByRole("group", { name: "Site type filter" }).getByRole("button", { name: "Any" }).click();
  const card = page.locator("li", { hasText: "Sneha Reddy" }).first();
  await card.getByRole("button", { name: "Save pro" }).click();
  await page.goto("/client/favorites");
  const fav = page.locator("li", { hasText: "Sneha Reddy" });
  await fav.getByRole("button", { name: "Note/tags" }).click();
  await fav.getByLabel("Note").fill("Great with geysers");
  await fav.getByLabel("Tags (comma-separated)").fill("geyser, weekend");
  await fav.getByRole("button", { name: "Save" }).click();
  await expect(fav.getByText("“Great with geysers”")).toBeVisible();
  await expect(fav.getByText("#weekend")).toBeVisible();

  // Smart ranking on a job page uses the shortlist tags.
  const job = await postJob(request, client, { title: `Geyser service ${Date.now().toString(36)}`, category: "plumbing" });
  await page.goto(`/client/jobs/${job.id}`);
  const shortlist = page.locator("section", { has: page.getByRole("heading", { name: "Invite from shortlist" }) });
  await expect(shortlist.getByText("Sneha Reddy")).toBeVisible();
});
