import { LEAD_GROUPS, leadGroupSlug } from "./leadGroups";

/** Pages anyone (and any crawler) can open without signing in. */
export function publicPaths(): string[] {
  return ["/", "/register", "/login", "/terms", "/privacy", ...LEAD_GROUPS.map((g) => `/categories/${leadGroupSlug(g)}`)];
}

const clean = (base: string) => base.replace(/\/+$/, "");

export function sitemapXml(base: string, lastmod = new Date().toISOString().slice(0, 10)): string {
  const urls = publicPaths()
    .map((p) => `  <url><loc>${clean(base)}${p}</loc><lastmod>${lastmod}</lastmod></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** Signed-in areas and the API are kept out of search results. */
export function robotsTxt(base: string): string {
  const lines = ["User-agent: *", "Allow: /"];
  for (const p of ["/api/", "/uploads/", "/client", "/professional", "/admin", "/settings", "/reset-password", "/verify-email"]) {
    lines.push(`Disallow: ${p}`);
  }
  lines.push("", `Sitemap: ${clean(base)}/sitemap.xml`, "");
  return lines.join("\n");
}
