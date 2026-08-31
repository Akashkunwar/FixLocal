/**
 * Step 13 extras + core smoke (login → job → bid → accept).
 */
const API = process.env.API_URL || "http://localhost:3001";
const PASS = process.env.SEED_PASSWORD || "Password123!";

async function api(path, { method = "GET", token, body, formData } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !formData) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: formData || payload,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data.message || ""}`);
  return data;
}

async function login(email) {
  return api("/api/auth/login", {
    method: "POST",
    body: { email, password: PASS },
  });
}

async function main() {
  const results = [];
  const ts = Date.now();

  const health = await api("/health");
  results.push(`health redis=${health.redis}`);
  if (health.redis !== "connected") {
    throw new Error("Expected Redis connected for this test (start redis or set REDIS_URL)");
  }

  const admin = await login("admin@fixlocal.local");
  const home = await login("home@fixlocal.local");
  const pro = await login("pro@fixlocal.local");

  await api(`/api/admin/tradespeople/${pro.user.id}/verify`, {
    method: "PATCH",
    token: admin.token,
    body: { status: "verified" },
  });

  const fd = new FormData();
  fd.append("title", `Step13 cache job ${ts}`);
  fd.append("description", "redis + payment test");
  fd.append("category", "plumbing");
  fd.append("maxBids", "3");
  const created = await api("/api/jobs", {
    method: "POST",
    token: home.token,
    formData: fd,
    body: fd,
  });
  const jobId = created.job.id;
  results.push("created open job (cache invalidated)");

  // First open-list as pro → miss
  const list1 = await api("/api/jobs?limit=5", { token: pro.token });
  if (list1.cached === true) throw new Error("expected cache miss on first open list");
  results.push(`open list #1 cached=${list1.cached}`);

  // Second → hit
  const list2 = await api("/api/jobs?limit=5", { token: pro.token });
  if (list2.cached !== true) throw new Error("expected cache hit on second open list");
  results.push(`open list #2 cached=${list2.cached}`);

  // Core: bid → accept → payment simulated
  const bid = await api(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    token: pro.token,
    body: { amount: 900, message: "step13" },
  });
  results.push("pro placed bid");

  const accepted = await api(`/api/bids/${bid.bid.id}/accept`, {
    method: "POST",
    token: home.token,
  });
  if (accepted.job.status !== "awarded") throw new Error("expected awarded");
  if (accepted.job.paymentStatus !== "simulated_paid") {
    throw new Error(`expected simulated_paid, got ${accepted.job.paymentStatus}`);
  }
  results.push("accept → awarded + paymentStatus=simulated_paid");

  // Cache cleared after accept — next list should be miss then reflect non-open job absence
  const list3 = await api("/api/jobs?limit=5", { token: pro.token });
  if (list3.cached === true) throw new Error("expected cache miss after accept invalidate");
  const stillOpen = list3.jobs.some((j) => j.id === jobId);
  if (stillOpen) throw new Error("accepted job should not appear in open list");
  results.push("after accept: cache miss + job gone from open list");

  console.log(results.map((r) => `PASS: ${r}`).join("\n"));
  console.log("\nSTEP 13 EXTRA TESTS PASSED");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
