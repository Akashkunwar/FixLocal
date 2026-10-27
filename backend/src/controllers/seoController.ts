import type { Request, Response } from "express";
import { z } from "zod";
import { AppDataSource } from "../data-source";
import { config } from "../config";
import { User, UserRole } from "../entities/User";
import { TradespersonProfile, VerificationStatus } from "../entities/TradespersonProfile";
import { publicUrl } from "../services/files";

/**
 * Server-side meta for public pages ("SSR-lite"). nginx inlines GET /api/seo/pros/:id/head into the
 * <head> of /pros/:id with an SSI include, so crawlers and link previews (WhatsApp, Facebook, X)
 * see the professional's name, summary and rating without running JavaScript.
 */

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const absolute = (path: string) => `${config().appUrl}${path}`;

type ProCard = {
  userId: string;
  name: string;
  city: string | null;
  skills: string | null;
  bio: string | null;
  serviceAreas: string | null;
  averageRating: number;
  reviewCount: number;
  avatarUrl: string | null;
};

async function publicPro(userId: string): Promise<ProCard | null> {
  if (!z.uuid().safeParse(userId).success) return null;
  const row = await AppDataSource.getRepository(TradespersonProfile)
    .createQueryBuilder("p")
    .innerJoinAndMapOne("p.user", User, "u", "u.id = p.userId")
    .where("p.userId = :userId", { userId })
    .andWhere("p.verificationStatus = :v", { v: VerificationStatus.VERIFIED })
    .andWhere("u.role = :role AND u.deletedAt IS NULL AND u.isSuspended = false", { role: UserRole.TRADESPERSON })
    .getOne();
  if (!row) return null;
  const user = (row as TradespersonProfile & { user: User }).user;
  return {
    userId,
    name: user.name?.trim() || "Professional",
    city: row.city ?? null,
    skills: row.skills ?? null,
    bio: row.bio ?? null,
    serviceAreas: row.serviceAreas ?? null,
    averageRating: Number(row.averageRating || 0),
    reviewCount: row.reviewCount || 0,
    avatarUrl: publicUrl(user.avatarUrl),
  };
}

export function proDescription(p: ProCard): string {
  const parts = [`${p.name}${p.skills ? `: ${p.skills}` : ""}${p.city ? ` in ${p.city}` : ""}.`];
  if (p.reviewCount > 0)
    parts.push(`Rated ${p.averageRating.toFixed(1)}/5 from ${p.reviewCount} review${p.reviewCount === 1 ? "" : "s"}.`);
  parts.push("Verified professional on FixLocal. Get a quote.");
  return clip(parts.join(" "), 160);
}

function notFoundHead() {
  return [
    `<title>Professional not found · FixLocal</title>`,
    `<meta name="robots" content="noindex" />`,
    `<meta name="description" content="This professional's profile isn't available." />`,
  ].join("\n");
}

export function proHeadHtml(p: ProCard): string {
  const url = absolute(`/pros/${p.userId}`);
  const title = clip(
    `${p.name}${p.skills ? ` – ${p.skills.split(",")[0].trim()}` : ""}${p.city ? ` in ${p.city}` : ""}`,
    70
  );
  const description = proDescription(p);
  const image = p.avatarUrl ? absolute(p.avatarUrl) : absolute("/icon-512.png");
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: p.name,
    url,
    image,
    description: clip(p.bio || description, 300),
    ...(p.city ? { address: { "@type": "PostalAddress", addressLocality: p.city, addressCountry: "IN" } } : {}),
    ...(p.serviceAreas
      ? {
          areaServed: p.serviceAreas
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean)
            .slice(0, 10),
        }
      : {}),
    ...(p.reviewCount > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: p.averageRating.toFixed(1),
            reviewCount: p.reviewCount,
          },
        }
      : {}),
  };
  return [
    `<title>${esc(title)} · FixLocal</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="profile" />`,
    `<meta property="og:site_name" content="FixLocal" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:locale" content="en_IN" />`,
    `<meta name="twitter:card" content="summary" />`,
    // "<" is escaped so profile text can never close the script element.
    `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`,
  ].join("\n");
}

export async function proHead(req: Request, res: Response) {
  const p = await publicPro(String(req.params.userId));
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "public, max-age=300");
  // Always 200: a failed SSI include would leave the page without any head tags.
  res.send(p ? proHeadHtml(p) : notFoundHead());
}

/** Every verified professional, for search engines (linked from robots.txt via /sitemap-pros.xml). */
export async function proSitemap(_req: Request, res: Response) {
  const rows = await AppDataSource.getRepository(TradespersonProfile)
    .createQueryBuilder("p")
    .innerJoin(User, "u", "u.id = p.userId")
    .select(['p.userId AS "userId"', 'p.updatedAt AS "updatedAt"'])
    .where("p.verificationStatus = :v", { v: VerificationStatus.VERIFIED })
    .andWhere("u.deletedAt IS NULL AND u.isSuspended = false")
    .orderBy("p.updatedAt", "DESC")
    .limit(50_000)
    .getRawMany<{ userId: string; updatedAt: Date | null }>();
  const urls = rows
    .map((r) => {
      const lastmod = r.updatedAt ? `<lastmod>${new Date(r.updatedAt).toISOString().slice(0, 10)}</lastmod>` : "";
      return `  <url><loc>${esc(absolute(`/pros/${r.userId}`))}</loc>${lastmod}</url>`;
    })
    .join("\n");
  res.set("Content-Type", "application/xml; charset=utf-8");
  res.set("Cache-Control", "public, max-age=3600");
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
}
