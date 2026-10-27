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
  lines.push("", `Sitemap: ${clean(base)}/sitemap.xml`, `Sitemap: ${clean(base)}/sitemap-pros.xml`, "");
  return lines.join("\n");
}

/** Where nginx asks the API for a pro's <head> tags (see nginx.conf, location ^/pros/). */
export const PRO_HEAD_INCLUDE = '<!--# include virtual="/api/seo/pros/$pro_id/head" -->';

/**
 * The app shell served for /pros/:id. The generic title, description, canonical and social tags are
 * removed and replaced by an SSI include, so crawlers and link previews get the pro's own tags
 * without JavaScript. The React app still boots exactly as on any other page.
 */
export function proShellHtml(indexHtml: string): string {
  const stripped = indexHtml
    .replace(/\s*<title>[\s\S]*?<\/title>/i, "")
    .replace(/\s*<meta\s+name="description"[^>]*>/gi, "")
    .replace(/\s*<meta\s+(?:property|name)="(?:og|twitter):[^"]*"[^>]*>/gi, "")
    .replace(/\s*<link\s+rel="canonical"[^>]*>/gi, "");
  if (!/<\/head>/i.test(stripped)) throw new Error("index.html has no </head>");
  return stripped.replace(/\s*<\/head>/i, `\n    ${PRO_HEAD_INCLUDE}\n  </head>`);
}
