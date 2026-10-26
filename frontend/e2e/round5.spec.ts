import { expect, test } from "@playwright/test";
import { apiCall, apiLogin, login, postJob, SEEDED } from "./fixtures";

type Notif = { title: string; type: string; link?: string };

test("a pro saves a job alert and is notified when a matching job is posted", async ({ page, request }) => {
  const pro = await apiLogin(request, SEEDED.pro2);
  const client = await apiLogin(request, SEEDED.client);
  await login(page, SEEDED.pro2);
  await page.goto("/professional/alerts");
  await expect(page.getByRole("heading", { name: "Job alerts", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /Electrical/ }).click();
  await expect(page.getByRole("button", { name: /Electrical/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("City").fill("Bengaluru");
  await page.getByLabel("Name (optional)").fill("E2E electrical alert");
  await expect(page.getByText(/open jobs? from the last 30 days match right now/)).toBeVisible();
  await page.getByRole("button", { name: "Save alert" }).click();
  const card = page.getByRole("listitem").filter({ hasText: "E2E electrical alert" });
  await expect(card).toContainText("Electrical · Bengaluru");

  const title = `E2E alert job ${Date.now().toString(36)}`;
  const job = await postJob(request, client, { title, category: "electrical" });
  await postJob(request, client, { title: `${title} plumbing`, category: "plumbing" });
  const { notifications } = await apiCall<{ notifications: Notif[] }>(request, pro, "get", "/api/notifications");
  const hits = notifications.filter((n) => n.type === "job_alert" && n.title.includes(title));
  expect(hits).toHaveLength(1);
  expect(hits[0].link).toBe(`/professional/jobs/${job.id}`);

  // Pause, then delete (keeps the shared e2e data quiet for other specs).
  await card.getByRole("button", { name: "Pause E2E electrical alert" }).click();
  await expect(card).toContainText("Paused");
  await card.getByRole("button", { name: "Delete E2E electrical alert" }).click();
  await expect(card).toHaveCount(0);
});
