import { describe, expect, it } from "vitest";
import { publicPaths, robotsTxt, sitemapXml } from "./seo";

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
  });
});
