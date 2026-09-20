import { expect, test } from "@playwright/test";
import { blockMapTiles, mailLink, PASSWORD, pngBytes, uniqueEmail } from "./fixtures";

test("client registers, verifies email, and posts a job with photos and a map pin (journey 1)", async ({ page, request }) => {
  await blockMapTiles(page);
  const email = uniqueEmail("client");

  await page.goto("/register");
  await page.getByRole("button", { name: /^Client/ }).click();
  await page.getByLabel("Full name").fill("Asha Client");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/client$/);

  // Unverified: the banner is shown and posting is refused by the server.
  await expect(page.getByText(/Verify your email/)).toBeVisible();

  const link = await mailLink(request, email, "verify-email");
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
  await page.getByRole("link", { name: "Continue" }).click();
  await expect(page.getByText(/Verify your email/)).toHaveCount(0);

  // Wizard step 1: basics.
  await page.goto("/client/jobs/new");
  const title = `Bathroom tap replacement ${Date.now().toString(36)}`;
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Description").fill("Old mixer tap leaks at the base; replace with a new one I have bought.");
  await page.getByRole("button", { name: /Plumbing/ }).first().click();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2: budget and location, with a pin dropped on the map.
  await page.getByLabel("Budget min (₹)").fill("800");
  await page.getByLabel("Budget max (₹)").fill("2500");
  await page.getByLabel("Address").fill("4th Cross, HAL 2nd Stage");
  await page.getByLabel("Neighborhood").fill("Indiranagar");
  const map = page.locator(".leaflet-container");
  await map.click({ position: { x: 120, y: 90 } });
  await expect(page.getByLabel("Latitude")).not.toHaveValue("");
  const lat = await page.getByLabel("Latitude").inputValue();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3: two photos, then post.
  await page.getByLabel(/Photos/).setInputFiles([
    { name: "before-1.png", mimeType: "image/png", buffer: pngBytes(1) },
    { name: "before-2.png", mimeType: "image/png", buffer: pngBytes(2) },
  ]);
  await expect(page.locator("ul img")).toHaveCount(2);
  await page.getByRole("button", { name: "Post job" }).click();

  await expect(page).toHaveURL(/\/client\/jobs\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const jobId = page.url().split("/").pop()!;

  // The server stored both photos and the pin.
  const res = await page.request.get(`/api/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${await accessToken(page)}` },
  });
  const { job } = await res.json();
  expect(job.photoUrls).toHaveLength(2);
  expect(String(job.lat)).toBe(String(Number(lat)));

  await page.goto("/client");
  await expect(page.getByText(title)).toBeVisible();
});

/** The SPA keeps its token in memory; tests borrow a fresh one via the refresh cookie. */
async function accessToken(page: import("@playwright/test").Page) {
  const res = await page.request.post("/api/auth/refresh");
  return (await res.json()).token as string;
}
