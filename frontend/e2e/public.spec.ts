import { expect, test } from "@playwright/test";
import { login, SEEDED } from "./fixtures";

test.describe("public pages and legacy routes (journey 16)", () => {
  test("landing page and a category hub render", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("FixLocal").first()).toBeVisible();
    const hub = page.locator('a[href^="/categories/"]').first();
    await hub.click();
    await expect(page).toHaveURL(/\/categories\//);
    await expect(page.locator("h1, h2").first()).toBeVisible();
  });

  test("demo credentials are not shown outside demo builds (M-9)", async ({ page }) => {
    for (const path of ["/", "/login"]) {
      await page.goto(path);
      await expect(page.locator("body")).not.toContainText("Password123");
      await expect(page.getByText(/Demo logins|Demo accounts/)).toHaveCount(0);
    }
    await expect(page.getByLabel("Email")).toHaveValue("");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  });

  test("old /homeowner and /tradesperson links land on the new URLs", async ({ page }) => {
    await login(page, SEEDED.client);
    await page.goto("/homeowner/jobs/new?from=old");
    await expect(page).toHaveURL(/\/client\/jobs\/new\?from=old$/);
    await page.goto("/homeowner");
    await expect(page).toHaveURL(/\/client$/);
  });

  test("a protected deep link returns there after login", async ({ page }) => {
    await page.goto("/client/favorites");
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("Email").fill(SEEDED.client);
    await page.getByLabel("Password", { exact: true }).fill("E2e-Password-123");
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await expect(page).toHaveURL(/\/client\/favorites$/);
  });

  test("pros hitting a legacy link are redirected too", async ({ page }) => {
    await login(page, SEEDED.pro);
    await page.goto("/tradesperson/my-jobs");
    await expect(page).toHaveURL(/\/professional\/my-jobs$/);
  });
});
