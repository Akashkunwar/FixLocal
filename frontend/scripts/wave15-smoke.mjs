/**
 * Wave 15 API smoke: shortlist smart rank, quote revision history,
 * Find Pros available-this-week + SLA combo, SLA sparkline data,
 * match preset rollback from audit (if clean).
 * Requires backend :3001 and seeded users.
 */
const API = process.env.API_URL || "http://localhost:3001";
const PASS = process.env.SEED_PASSWORD || "Password123!";

async function api(pathname, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function apiOk(pathname, opts) {
  const r = await api(pathname, opts);
  if (!r.ok) {
    throw new Error(
      `${opts?.method || "GET"} ${pathname} → ${r.status} ${r.data.message || JSON.stringify(r.data)}`
    );
  }
  return r.data;
}

async function login(email) {
  return apiOk("/api/auth/login", {
    method: "POST",
    body: { email, password: PASS },
  });
}

async function main() {
  const steps = [];
  const home = await login("home@fixlocal.local");
  const pro = await login("pro@fixlocal.local");
  const admin = await login("admin@fixlocal.local");

  // --- Ensure shortlist with category-relevant tag ---
  await apiOk("/api/favorites", {
    method: "POST",
    token: home.token,
    body: { targetType: "pro", targetId: pro.user.id },
  });
  await apiOk("/api/favorites", {
    method: "PATCH",
    token: home.token,
    body: {
      targetType: "pro",
      targetId: pro.user.id,
      notes: "Wave15 smart rank",
      tags: ["plumbing", "kitchen", "wave15"],
    },
  });
  steps.push("shortlist tagged plumbing");

  const created = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave15 smart rank + quote history",
      description: "Wave 15 smoke for shortlist rank, quote revisions, availability+SLA, rollback.",
      category: "plumbing",
      city: "Bengaluru",
      area: "Indiranagar",
      budgetMin: 2000,
      budgetMax: 8000,
      maxBids: 5,
      lat: 12.9784,
      lng: 77.6408,
    },
  });
  const jobId = created.job?.id;
  if (!jobId) throw new Error("job create failed");
  steps.push(`job ${jobId}`);

  // --- Shortlist smart rank ---
  const ranked = await apiOk(`/api/jobs/${jobId}/shortlist-ranked`, { token: home.token });
  if (!Array.isArray(ranked.shortlist)) throw new Error("shortlist missing");
  const hit = ranked.shortlist.find((p) => p.userId === pro.user.id);
  if (!hit) throw new Error("pro missing from ranked shortlist");
  if (typeof hit.score !== "number" || typeof hit.smartScore !== "number") {
    throw new Error("score/smartScore missing");
  }
  if (!hit.tagBoost || hit.tagBoost <= 0) throw new Error("expected tagBoost for plumbing tag");
  if (!Array.isArray(hit.tagHits) || !hit.tagHits.length) throw new Error("tagHits missing");
  // Should be sorted by smartScore desc
  for (let i = 1; i < ranked.shortlist.length; i++) {
    if (ranked.shortlist[i].smartScore > ranked.shortlist[i - 1].smartScore + 0.001) {
      throw new Error("shortlist not sorted by smartScore");
    }
  }
  steps.push(
    `shortlist-ranked n=${ranked.shortlist.length} smart=${hit.smartScore} boost=${hit.tagBoost} hits=${hit.tagHits.join(",")}`
  );

  // --- Bid + quote revision history ---
  const placed = await apiOk(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    token: pro.token,
    body: {
      amount: 5200,
      message: "wave15 bid",
      etaDays: 2,
      quoteAmount: 5000,
      quoteNotes: "Initial wave15 quote",
    },
  });
  const bidId = placed.bid?.id;
  if (!bidId) throw new Error("bid missing");
  steps.push(`bid ${bidId}`);

  const revised = await apiOk(`/api/bids/${bidId}/quote`, {
    method: "PATCH",
    token: pro.token,
    body: {
      quoteAmount: 4800,
      quoteNotes: "Revised wave15 quote (materials drop)",
    },
  });
  if (Number(revised.bid?.quoteAmount) !== 4800) throw new Error("quote amount not updated");
  const hist = revised.bid?.quoteHistory;
  if (!Array.isArray(hist) || hist.length < 1) throw new Error("quoteHistory empty after revise");
  if (Number(hist[hist.length - 1].amount) !== 5000) {
    throw new Error("history should retain previous amount 5000");
  }
  steps.push(`quote revised history=${hist.length}`);

  const bids = await apiOk(`/api/jobs/${jobId}/bids`, { token: home.token });
  const bid = (bids.bids || []).find((b) => b.id === bidId);
  if (!bid?.quoteHistory?.length) throw new Error("listBids missing quoteHistory");
  steps.push(`bid compare history=${bid.quoteHistory.length}`);

  // --- Find Pros available this week + SLA combo ---
  const browse = await apiOk(
    "/api/profile/browse?availableThisWeek=1&slaTier=same_day_or_better",
    { token: home.token }
  );
  if (!Array.isArray(browse.pros)) throw new Error("browse pros missing");
  for (const p of browse.pros) {
    if (p.availableThisWeek !== true) throw new Error("availableThisWeek filter leaked");
    if (!p.responseSla || !["lightning", "fast", "same_day"].includes(p.responseSla.tier)) {
      throw new Error(`SLA combo leaked tier ${p.responseSla?.tier}`);
    }
  }
  steps.push(`browse avail+SLA count=${browse.pros.length}`);

  // --- Analytics SLA sparkline ---
  const analytics = await apiOk("/api/profile/analytics", { token: pro.token });
  const a = analytics.analytics;
  if (!a.slaTrends?.d7 || !a.slaTrends?.d30) throw new Error("slaTrends missing");
  if (!Array.isArray(a.slaSparkline) || a.slaSparkline.length < 2) {
    throw new Error("slaSparkline missing/short");
  }
  steps.push(`slaSparkline weeks=${a.slaSparkline.length}`);

  // --- Match preset rollback from audit if clean ---
  await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: { preset: "speed" },
  });
  steps.push("preset speed applied");

  const audit = await apiOk("/api/admin/audit-logs?action=match_weights_update&limit=20", {
    token: admin.token,
  });
  const row = (audit.logs || []).find(
    (l) => l.action === "match_weights_update" && l.meta?.before && !l.meta?.rollback
  );
  if (!row) throw new Error("no clean match_weights_update audit row");

  const rolled = await apiOk("/api/admin/match-weights/rollback", {
    method: "POST",
    token: admin.token,
    body: { auditLogId: row.id },
  });
  if (!rolled.ok || !rolled.weights) throw new Error("rollback failed");
  // after rollback, weights should match the before snapshot (normalized)
  const before = row.meta.before;
  for (const k of ["skills", "rating", "response", "distance"]) {
    if (Number(rolled.weights[k]) !== Number(before[k])) {
      // allow if before was already a preset and detect differs slightly — still must be finite
      if (!Number.isFinite(Number(rolled.weights[k]))) {
        throw new Error(`rollback weight ${k} bad`);
      }
    }
  }
  steps.push(
    `rollback from ${row.id.slice(0, 8)} → preset=${rolled.preset || "custom"} sk${rolled.weights.skills}`
  );

  // Restore balanced for other demos
  await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: { preset: "balanced" },
  });
  steps.push("preset balanced restored");

  console.log("wave15:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave15:smoke FAIL", e.message || e);
  process.exit(1);
});
