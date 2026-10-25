import { describe, expect, it } from "vitest";
import { api, pro, rows } from "./helpers";
import { VerificationStatus } from "../src/entities/TradespersonProfile";

const head = (id: string) => api().get(`/api/seo/pros/${id}/head`);

describe("server-rendered meta for public pro profiles", () => {
  it("gives crawlers the name, summary, rating, canonical URL and JSON-LD", async () => {
    const p = await pro({ name: "Ravi Kumar", profile: { skills: "Plumbing, leak repair", city: "Bengaluru", reviewCount: 3, averageRating: 4.67 } });
    const res = await head(p.user.id).expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.headers["cache-control"]).toMatch(/max-age=300/);
    expect(res.text).toContain("<title>Ravi Kumar – Plumbing in Bengaluru · FixLocal</title>");
    expect(res.text).toMatch(/<meta name="description" content="Ravi Kumar: Plumbing, leak repair in Bengaluru\. Rated 4\.7\/5 from 3 reviews\./);
    expect(res.text).toContain(`<link rel="canonical" href="http`);
    expect(res.text).toContain(`/pros/${p.user.id}" />`);
    const ld = JSON.parse(res.text.match(/<script type="application\/ld\+json">(.*)<\/script>/)![1]);
    expect(ld["@type"]).toBe("LocalBusiness");
    expect(ld.aggregateRating).toEqual({ "@type": "AggregateRating", ratingValue: "4.7", reviewCount: 3 });
    // Contact details never appear.
    expect(res.text).not.toContain(p.user.email);
    expect(res.text).not.toContain("+91");
  });

  it("escapes profile text so it can't inject markup", async () => {
    const p = await pro({ name: `</script><script>alert(1)</script>"><img src=x>`, profile: { bio: "</script><b>x</b>" } });
    const res = await head(p.user.id).expect(200);
    expect(res.text).not.toContain("<script>alert");
    expect(res.text).not.toContain("<img");
    expect(res.text).not.toContain("<b>");
    expect(res.text.match(/<\/script>/g)).toHaveLength(1);
  });

  it("unverified, suspended, unknown or malformed ids get a noindex head", async () => {
    const pending = await pro({ proStatus: VerificationStatus.PENDING });
    const suspended = await pro({ suspended: true });
    for (const id of [pending.user.id, suspended.user.id, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      const res = await head(id).expect(200);
      expect(res.text).toContain(`<meta name="robots" content="noindex" />`);
      expect(res.text).not.toContain("ld+json");
    }
  });

  it("lists verified professionals in the sitemap and leaves the rest out", async () => {
    const verified = await pro();
    const pending = await pro({ proStatus: VerificationStatus.PENDING });
    const res = await api().get("/api/seo/sitemap-pros.xml").expect(200);
    expect(res.headers["content-type"]).toMatch(/application\/xml/);
    expect(res.text).toContain(`/pros/${verified.user.id}</loc>`);
    expect(res.text).not.toContain(pending.user.id);
    const [{ n }] = await rows<{ n: string }>(`SELECT count(*) AS n FROM "tradesperson_profiles" WHERE "verificationStatus" = 'verified'`);
    expect(res.text.match(/<url>/g)?.length ?? 0).toBeLessThanOrEqual(Number(n));
  });
});
