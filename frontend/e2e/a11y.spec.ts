import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { apiLogin, awardedJob, blockMapTiles, login, SEEDED } from "./fixtures";

/** WCAG 2.1 A/AA rules only (best-practice rules are advisory). */
async function audit(page: Page, name: string) {
  await page.waitForLoadState("load");
  // Wait for lazy routes and data to render, and for transitions to settle (colour contrast reads final colours).
  await page.locator("h1").first().waitFor({ timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // Leaflet tiles are third-party imagery and blocked in tests.
    .exclude(".leaflet-container")
    .analyze();
  const summary = result.violations.map((v) => ({
    page: name,
    rule: v.id,
    impact: v.impact,
    nodes: v.nodes.slice(0, 5).map((n) => `${n.target.join(" ")} :: ${n.failureSummary?.split("\n").slice(1, 2).join("")}`),
  }));
  // WCAG 1.4.10 Reflow: nothing may force sideways scrolling (checked at every size, matters at 390 px).
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= width + 1) return null;
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > width + 1 && !el.closest(".leaflet-container"))
      .slice(-3)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 4).join(".")}`);
    return { scrollWidth: document.documentElement.scrollWidth, width, wide };
  });
  if (overflow) summary.push({ page: name, rule: "reflow (horizontal scroll)", impact: "serious", nodes: overflow.wide });
  if (summary.length) console.log(JSON.stringify(summary, null, 2));
  return summary;
}

const sizes = [
  { name: "desktop", viewport: { width: 1280, height: 900 } },
  { name: "mobile", viewport: { width: 390, height: 844 } },
];

for (const size of sizes) {
  test.describe(`accessibility (${size.name})`, () => {
    test.use({ viewport: size.viewport });

    test("public pages have no WCAG A/AA violations", async ({ page, request }) => {
      const pro = await apiLogin(request, SEEDED.pro);
      const found = [];
      for (const [name, path] of [
        ["landing", "/"],
        ["login", "/login"],
        ["register", "/register"],
        ["forgot-password", "/forgot-password"],
        ["terms", "/terms"],
        ["privacy", "/privacy"],
        ["404", "/no-such-page"],
        ["category hub", "/categories/home-repair-and-maintenance"],
        ["public pro profile (signed out)", `/pros/${pro.id}`],
      ]) {
        await page.goto(path);
        found.push(...(await audit(page, name)));
      }
      expect(found).toEqual([]);
    });

    test("client pages have no WCAG A/AA violations", async ({ page, request }) => {
      await blockMapTiles(page);
      const client = await apiLogin(request, SEEDED.client2);
      const pro = await apiLogin(request, SEEDED.pro2);
      const { job } = await awardedJob(request, client, pro, 2200);
      await login(page, SEEDED.client2);
      const found = [];
      for (const [name, path] of [
        ["client dashboard", "/client"],
        ["post a job", "/client/jobs/new"],
        ["job detail", `/client/jobs/${job.id}`],
        ["find pros", "/client/pros"],
        ["shortlist", "/client/favorites"],
        ["pro profile", `/pros/${pro.id}`],
        ["settings", "/settings"],
      ]) {
        await page.goto(path);
        found.push(...(await audit(page, name)));
      }
      expect(found).toEqual([]);
    });

    test("professional and admin pages have no WCAG A/AA violations", async ({ page, browser, request }) => {
      const client = await apiLogin(request, SEEDED.client2);
      const pro = await apiLogin(request, SEEDED.pro2);
      const { job } = await awardedJob(request, client, pro, 2300);
      await login(page, SEEDED.pro2);
      const found = [];
      for (const [name, path] of [
        ["browse jobs", "/professional"],
        ["my jobs", "/professional/my-jobs"],
        ["pro job detail", `/professional/jobs/${job.id}`],
        ["portfolio", "/professional/profile"],
        ["analytics", "/professional/analytics"],
        ["job alerts", "/professional/alerts"],
      ]) {
        await page.goto(path);
        found.push(...(await audit(page, name)));
      }
      const adminCtx = await browser.newContext({ viewport: size.viewport });
      const admin = await adminCtx.newPage();
      await login(admin, SEEDED.admin);
      for (const [name, path] of [
        ["admin home", "/admin"],
        ["admin pros", "/admin/tradespeople"],
      ]) {
        await admin.goto(path);
        found.push(...(await audit(admin, name)));
      }
      await adminCtx.close();
      expect(found).toEqual([]);
    });
  });
}
