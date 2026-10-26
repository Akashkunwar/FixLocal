import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { apiCall, apiLogin, login, postJob, registerViaApi, SEEDED, type ApiUser } from "./fixtures";

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
