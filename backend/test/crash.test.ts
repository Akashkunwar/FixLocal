import { describe, expect, it } from "vitest";
import { admin, api, client, pro } from "./helpers";

/** C-1: malformed input must never take the process down. */
describe("C-1 crash resistance", () => {
  const healthy = async () => {
    const res = await api().get("/health");
    expect(res.status).toBe(200);
    expect(res.body.db).toBe("up");
  };

  it("rejects a non-string password on login without crashing (unauthenticated)", async () => {
    const res = await api().post("/api/auth/login").send({ email: "admin@fixlocal.local", password: { x: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
    await healthy();
  });

  it("rejects a malformed job id", async () => {
    const c = await client();
    const res = await api().get("/api/jobs/not-a-uuid").set(c.auth);
    expect(res.status).toBe(400);
    expect(res.body.issues[0].path).toBe("params.id");
    await healthy();
  });

  it("rejects invalid enums, dates and numbers", async () => {
    const a = await admin();
    const c = await client();
    const p = await pro();
    const cases = [
      api().get("/api/disputes?status=bogus").set(a.auth),
      api().get("/api/admin/tradespeople?status=bogus").set(a.auth),
      api().get("/api/admin/audit-logs?action=bogus").set(a.auth),
      api().get("/api/jobs?from=abc").set(c.auth),
      api().get("/api/jobs?limit=abc&page=-4").set(c.auth),
      api().patch("/api/profile").set(p.auth).send({ yearsExperience: 2.5 }),
      api().post("/api/jobs").set(c.auth).send({ title: "x", description: "y", category: "plumbing", budgetMin: 1e12 }),
      api().post("/api/favorites").set(c.auth).send({ targetType: "job", targetId: "nope" }),
      api().post("/api/admin/audit-notes").set(a.auth).send({ note: "n", targetId: "not-a-uuid" }),
      api().post("/api/reviews").set(c.auth).send({ jobId: "x", rating: 9 }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.code).toBeTruthy();
    }
    await healthy();
  });

  it("returns JSON errors for broken JSON and oversized bodies", async () => {
    const bad = await api().post("/api/auth/login").set("Content-Type", "application/json").send("{not json");
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("INVALID_JSON");
    const big = await api().post("/api/auth/login").send({ email: "a@b.co", password: "x".repeat(300_000) });
    expect(big.status).toBe(413);
    await healthy();
  });

  it("handles concurrent duplicate registrations with one 201 and 409s", async () => {
    const email = `race-${Date.now()}@test.fixlocal`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api().post("/api/auth/register").send({ email, password: "Long-enough-pass-9", role: "HOMEOWNER" })
      )
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
    await healthy();
  });

  it("unknown routes return a JSON 404", async () => {
    const res = await api().get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ROUTE_NOT_FOUND");
  });

  it("survives a burst of random malformed requests", async () => {
    const c = await client();
    const p = await pro();
    const junk = ["", "null", "[]", "{}", "-1", "1e309", "'; DROP TABLE users;--", "%00", "{\"$ne\":1}", "x".repeat(300)];
    const paths = [
      "/api/jobs/%s",
      "/api/jobs/%s/bids",
      "/api/bids/%s/accept",
      "/api/jobs/%s/payments/%s/release",
      "/api/messages/%s",
      "/api/profile/user/%s",
      "/api/reviews/job/%s",
      "/api/files/%s",
      "/api/jobs?category=%s&sort=%s",
      "/api/profile/browse?nearLat=%s&maxKm=%s",
    ];
    let n = 0;
    for (const tmpl of paths) {
      for (const j of junk) {
        const url = tmpl.replace(/%s/g, encodeURIComponent(j));
        const who = n++ % 2 ? c : p;
        const method = n % 3 === 0 ? "post" : "get";
        const res = await api()[method](url).set(who.auth).send({ amount: j, body: j, expectedAmount: j });
        expect(res.status, `${method} ${url}`).toBeLessThan(500);
        expect(typeof res.body).toBe("object");
      }
    }
    await healthy();
  });
});
