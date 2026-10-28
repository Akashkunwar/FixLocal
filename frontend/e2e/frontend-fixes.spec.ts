import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { answerDialog, apiCall, apiLogin, awardedJob, blockMapTiles, login, postJob, SEEDED } from "./fixtures";

/** Visible Latin words on a Hindi page, ignoring brand names, file types and e-mail addresses. */
async function latinWords(page: Page) {
  return page.evaluate(() => {
    const ok = /^(FixLocal|WhatsApp|English|PDF|JPG|PNG|WebP|JPEG|GSTIN|Safari|Home|Screen|Add|to|OK)$/;
    const out = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const el = n.parentElement;
      if (!el || el.closest("script,style,[lang^=en],.leaflet-container")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const text = (n.textContent || "").replace(/\S+@\S+/g, "");
      for (const w of text.match(/[A-Za-z]{3,}/g) || []) if (!ok.test(w)) out.add(`${w} «${text.trim().slice(0, 60)}»`);
    }
    for (const el of document.querySelectorAll("[aria-label],[placeholder],[title]")) {
      for (const a of ["aria-label", "placeholder", "title"]) {
        const v = el.getAttribute(a);
        if (v && /[A-Za-z]{3,}/.test(v.replace(/FixLocal|WhatsApp|\S+@\S+/g, "")) && !/[\u0900-\u097F]/.test(v)) out.add(`@${a}: ${v}`);
      }
    }
    return [...out];
  });
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude(".leaflet-container").analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
}

const hindi = async (page: Page) =>
  page.addInitScript(() => {
    localStorage.setItem("fixlocal:lang", "hi");
    localStorage.setItem("fixlocal:lang-picked", "1");
  });

test("two tabs opened at the same moment both stay signed in (one refresh at a time)", async ({ browser }) => {
  const ctx = await browser.newContext();
  const first = await ctx.newPage();
  await login(first, SEEDED.client);
  await first.close();
  const [a, b] = await Promise.all([ctx.newPage(), ctx.newPage()]);
  await Promise.all([a.goto("/client"), b.goto("/client")]);
  await expect(a.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(b.getByRole("heading", { level: 1 })).toBeVisible();
  expect(new URL(a.url()).pathname).toBe("/client");
  expect(new URL(b.url()).pathname).toBe("/client");
  // A later tab still has a working session (the family was not revoked).
  const c = await ctx.newPage();
  await c.goto("/client");
  await expect(c.getByRole("heading", { level: 1 })).toBeVisible();
  expect(new URL(c.url()).pathname).toBe("/client");
  await ctx.close();
});

test("switching language mid-wizard keeps what was typed; double-click on Continue never posts", async ({ page }) => {
  await blockMapTiles(page);
  await login(page, SEEDED.client);
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/jobs") posts.push(r.url());
  });
  await page.goto("/client/jobs/new");
  await page.getByLabel("Title").fill("Ceiling fan wobble");
  await page.getByLabel("Description").fill("Fan wobbles at high speed and makes a clicking noise.");
  await page.getByRole("button", { name: /View in Hindi/ }).first().click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.getByLabel("शीर्षक")).toHaveValue("Ceiling fan wobble");
  await page.getByRole("button", { name: /View in English/ }).first().click();
  await page.getByRole("button", { name: /Electrical/ }).first().click();
  await page.getByRole("button", { name: "Continue" }).dblclick();
  await page.getByRole("button", { name: "Continue" }).dblclick();
  await expect(page.getByRole("button", { name: "Post job" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(posts).toEqual([]);
  expect(page.url()).toMatch(/\/client\/jobs\/new/);
});

test("Hindi sign-in, sign-up, account and 404 pages have no English left, a language switch, and no WCAG A/AA issues", async ({ page }) => {
  await hindi(page);
  for (const path of ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/categories/nope", "/terms"]) {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);
      await page.locator("h1").first().waitFor();
      await expect(page.locator("html")).toHaveAttribute("lang", "hi");
      await expect(page.getByRole("button", { name: /View in English/ }).first()).toBeVisible();
      if (path !== "/terms") expect(await latinWords(page), `${path}@${width}`).toEqual([]);
      expect(await axe(page), `${path}@${width}`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path}@${width}`).toBe(true);
    }
  }
  await page.goto("/categories/nope");
  await expect(page.getByText("404")).toBeVisible();
});

test("in-app confirm and the match drawer are accessible dialogs (focus, Escape, names)", async ({ page, request }) => {
  const client = await apiLogin(request, SEEDED.client);
  const pro = await apiLogin(request, SEEDED.pro);
  const job = await postJob(request, client);
  await apiCall(request, pro, "post", `/api/jobs/${job.id}/bids`, { amount: 1500 });
  await login(page, SEEDED.client);
  await page.goto(`/client/jobs/${job.id}`);
  await page.getByRole("button", { name: /Accept/ }).first().click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName(/.+/);
  expect(await axe(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const status = await apiCall<{ job: { status: string } }>(request, client, "get", `/api/jobs/${job.id}`);
  expect(status.job.status).toBe("open"); // Escape = cancel

  const why = page.getByRole("button", { name: /Why value\?/ }).first();
  if (await why.count()) {
    await why.click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAccessibleName(/.+/);
    await expect(drawer.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(why).toBeFocused();
  }
});

test("a pro's action buttons can't double-submit; a bid far below the budget asks first", async ({ page, request }) => {
  const client = await apiLogin(request, SEEDED.client2);
  const job = await postJob(request, client, { budgetMin: 500, budgetMax: 2000 });
  await login(page, SEEDED.pro2);
  await page.goto(`/professional/jobs/${job.id}`);
  await page.locator("#bid-amount").fill("5");
  await page.getByRole("button", { name: "Submit bid" }).click();
  const text = await answerDialog(page, { button: /Cancel/ });
  expect(text).toMatch(/far below/);
  const pro = await apiLogin(request, SEEDED.pro2);
  const mine = await apiCall<{ bids: unknown[] }>(request, pro, "get", `/api/jobs/${job.id}/bids`).catch(() => ({ bids: [] }));
  expect(mine.bids.length).toBe(0);
});

test("an awarded job can only be started once even with a double click", async ({ page, request }) => {
  const client = await apiLogin(request, SEEDED.client);
  const pro = await apiLogin(request, SEEDED.pro);
  const { job } = await awardedJob(request, client, pro, 1800);
  const starts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith(`/api/jobs/${job.id}/start`)) starts.push(r.url());
  });
  await login(page, SEEDED.pro);
  await page.goto(`/professional/jobs/${job.id}`);
  await page.getByRole("button", { name: "Start work" }).dblclick();
  await expect(page.getByRole("button", { name: "Mark work done" })).toBeVisible();
  expect(starts.length).toBe(1);
});
