import { describe, expect, it } from "vitest";
import indexHtml from "../../index.html?raw";
import { PRO_HEAD_INCLUDE, proShellHtml, publicPaths, robotsTxt, sitemapXml } from "./seo";

describe("seo", () => {
  it("lists the public pages, including every category hub", () => {
    const paths = publicPaths();
    expect(paths).toContain("/terms");
    expect(paths).toContain("/privacy");
    expect(paths).toContain("/categories/home-repair-and-maintenance");
    expect(paths.some((p) => p.startsWith("/client") || p.startsWith("/admin"))).toBe(false);
  });

  it("builds an absolute sitemap", () => {
    const xml = sitemapXml("https://fixlocal.in/", "2026-10-25");
    expect(xml).toContain("<loc>https://fixlocal.in/terms</loc>");
    expect(xml).not.toContain("fixlocal.in//");
    expect(xml).toContain("<lastmod>2026-10-25</lastmod>");
  });

  it("keeps private areas out of search and points to the sitemap", () => {
    const txt = robotsTxt("https://fixlocal.in");
    expect(txt).toMatch(/Disallow: \/api\//);
    expect(txt).toMatch(/Disallow: \/admin/);
    expect(txt).toMatch(/Sitemap: https:\/\/fixlocal\.in\/sitemap\.xml/);
    expect(txt).toMatch(/Sitemap: https:\/\/fixlocal\.in\/sitemap-pros\.xml/);
  });

  it("builds the pro-profile shell: generic tags out, the server-side include in", () => {
    const html = proShellHtml(indexHtml);
    expect(html).not.toMatch(/<title>/);
    expect(html).not.toMatch(/name="description"/);
    expect(html).not.toMatch(/property="og:/);
    expect(html).not.toMatch(/rel="canonical"/);
    expect(html).toContain(PRO_HEAD_INCLUDE);
    expect(html.indexOf(PRO_HEAD_INCLUDE)).toBeLessThan(html.indexOf("</head>"));
    // The app itself still boots.
    expect(html).toContain('<div id="root">');
    expect(html).toMatch(/<script type="module"/);
  });
});
