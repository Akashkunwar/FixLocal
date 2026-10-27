import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { apiCall, apiLogin, awardedJob, blockMapTiles, login, postJob, registerViaApi, SEEDED, type ApiUser } from "./fixtures";

type Text = { channel: string; to: string; text: string };

async function texts(request: import("@playwright/test").APIRequestContext) {
  const res = await request.get("/api/dev/outbox");
  return ((await res.json()) as { texts: Text[] }).texts;
}

test("a client verifies a mobile number and opts in to SMS and WhatsApp alerts", async ({ page, request }) => {
  const client = (await registerViaApi(request, "HOMEOWNER", "Texting Client")) as ApiUser;
  await login(page, client.email);
  await page.goto("/settings");
  const card = page.getByRole("region", { name: "Text alerts (SMS / WhatsApp)" });
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByRole("checkbox", { name: "SMS" })).toBeDisabled();
  await expect(card).toContainText("Quiet hours: nothing is sent between 10 PM and 8 AM IST");

  const phone = `9${String(Date.now()).slice(-9)}`;
  await card.getByLabel("Mobile number").fill(phone);
  await card.getByRole("button", { name: "Send code" }).click();
  await expect(card.getByRole("status")).toContainText("We sent a 6-digit code to +91");
  let code = "";
  await expect
    .poll(async () => {
      code = (await texts(request)).find((m) => m.to === `+91${phone}`)?.text.match(/\b(\d{6})\b/)?.[1] ?? "";
      return code;
    })
    .toMatch(/^\d{6}$/);
  await card.getByLabel("6-digit code").fill(code);
  await card.getByRole("button", { name: "Verify" }).click();
  await expect(card.getByText("Number verified.")).toBeVisible();
  await expect(card.getByText("Verified", { exact: true })).toBeVisible();

  await card.getByRole("checkbox", { name: "SMS" }).check();
  await expect(card.getByRole("checkbox", { name: "SMS" })).toBeChecked();
  await card.getByRole("checkbox", { name: "WhatsApp" }).check();
  await expect(card.getByRole("checkbox", { name: "WhatsApp" })).toBeChecked();
  await page.reload();
  await expect(page.getByRole("region", { name: "Text alerts (SMS / WhatsApp)" }).getByRole("checkbox", { name: "WhatsApp" })).toBeChecked();

  const axe = await new AxeBuilder({ page }).include("#text-alerts").analyze();
  expect(axe.violations).toEqual([]);

  // A first bid on their job queues a text on each channel (held until 8 AM if it's quiet hours).
  const job = await postJob(request, client, { title: `E2E texted job ${Date.now().toString(36)}` });
  const pro = await apiLogin(request, SEEDED.pro2);
  await apiCall(request, pro, "post", `/api/jobs/${job.id}/bids`, { amount: 2400, message: "Can do it this week, all parts included." });
  await expect
    .poll(async () => {
      const data = await apiCall<{ textMessages: { channel: string; body: string; status: string }[] }>(request, client, "get", "/api/auth/me/export");
      return data.textMessages.filter((m) => m.body.startsWith("FixLocal: New bid on your job")).map((m) => m.channel).sort();
    })
    .toEqual(["sms", "whatsapp"]);
});

/** WCAG A/AA via axe plus the 390 px reflow check (same rules as a11y.spec.ts). */
async function audit(page: Page, name: string) {
  await page.locator("h1").first().waitFor({ timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(600);
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
  test(`Hindi follows the account across devices and the main pages read in Hindi (${size.name})`, async ({ page, browser, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size.viewport);
    await blockMapTiles(page);
    const client = (await registerViaApi(request, "HOMEOWNER", "Hindi Client")) as ApiUser;
    const pro = await apiLogin(request, SEEDED.pro2);
    const { job } = await awardedJob(request, client, pro, 2600);

    await login(page, client.email);
    await page.getByRole("button", { name: /View in Hindi/ }).first().click();
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await expect(page.getByRole("heading", { level: 1, name: "मेरे काम" })).toBeVisible();
    // Saved on the account, not just this browser.
    await expect
      .poll(async () => (await apiCall<{ user: { language: string } }>(request, client, "get", "/api/auth/me")).user.language)
      .toBe("hi");

    const found: string[] = [];
    found.push(...(await audit(page, "dashboard")));
    await page.goto(`/client/jobs/${job.id}`);
    await expect(page.getByText("काम का सार").first()).toBeVisible();
    await expect(page.getByText("नकली एस्क्रो").first()).toBeVisible();
    found.push(...(await audit(page, "job page")));
    for (const [name, path, text] of [
      ["post a job", "/client/jobs/new", "शीर्षक"],
      ["settings", "/settings", "मैसेज अलर्ट (SMS / WhatsApp)"],
      ["notifications", "/notifications", "सूचनाएँ"],
      ["terms", "/terms", "यह कानूनी पाठ सिर्फ़ अंग्रेज़ी में है।"],
    ]) {
      await page.goto(path);
      await expect(page.getByText(text).first()).toBeVisible();
      found.push(...(await audit(page, name)));
    }
    expect(found).toEqual([]);

    // Logged out, this device keeps its own setting.
    await page.goto("/client");
    await page.getByRole("button", { name: "लॉग आउट" }).first().click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await expect(page.getByRole("heading", { level: 1, name: "फिर से स्वागत है" })).toBeVisible();

    // Another device: no local setting, but logging in brings Hindi back from the account.
    const other = await browser.newContext({ viewport: size.viewport });
    const phone = await other.newPage();
    await login(phone, client.email);
    await expect(phone.locator("html")).toHaveAttribute("lang", "hi");
    await expect(phone.getByRole("heading", { level: 1, name: "मेरे काम" })).toBeVisible();
    // Switching back to English there syncs to the account too.
    await phone.getByRole("button", { name: /View in English/ }).first().click();
    await expect(phone.getByRole("heading", { level: 1, name: "My jobs" })).toBeVisible();
    // The API token from the start of the test may have expired by now (20 s in e2e): log in again.
    const fresh = await apiLogin(request, client.email);
    await expect
      .poll(async () => (await apiCall<{ user: { language: string } }>(request, fresh, "get", "/api/auth/me")).user.language)
      .toBe("en");
    await other.close();

  });
}

test("a pro reads their job page, alerts and profile in Hindi", async ({ page, request }) => {
  const client = await apiLogin(request, SEEDED.client);
  const pro = await apiLogin(request, SEEDED.pro2);
  const { job } = await awardedJob(request, client, pro, 2100);
  await login(page, SEEDED.pro2);
  await page.getByRole("button", { name: /View in Hindi/ }).first().click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await page.goto(`/professional/jobs/${job.id}`);
  await expect(page.getByText("काम शुरू करें").first()).toBeVisible();
  await page.goto("/professional/alerts");
  await expect(page.getByText("रोज़ का सारांश").first()).toBeVisible();
  await page.goto(`/pros/${pro.id}`);
  await expect(page.getByText("हफ़्ते की उपलब्धता").first()).toBeVisible();
  // Put the account back to English for other tests that use this seeded pro.
  await apiCall(request, pro, "patch", "/api/auth/me", { language: "en" });
});
