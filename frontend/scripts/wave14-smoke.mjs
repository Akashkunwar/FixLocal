/**
 * Wave 14 API smoke: SLA trends 7/30d, shortlist notes/tags + bulk invite,
 * match weight presets + audit, Find Pros SLA filter, soft SLA-improve notify path.
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

function assertSla(sla, label) {
  if (!sla || typeof sla !== "object") throw new Error(`${label}: responseSla missing`);
  if (!sla.tier || !sla.label) throw new Error(`${label}: sla tier/label missing`);
}

async function main() {
  const steps = [];
  const home = await login("home@fixlocal.local");
  const home2 = await login("home2@fixlocal.local");
  const pro = await login("pro@fixlocal.local");
  const admin = await login("admin@fixlocal.local");

  // --- Match weight presets + audit ---
  let mw = await apiOk("/api/admin/match-weights", { token: admin.token });
  if (!mw.presets || mw.presets.length < 3) throw new Error("presets missing");
  if (!mw.presets.find((p) => p.id === "speed")) throw new Error("speed preset missing");
  steps.push(`presets ${mw.presets.map((p) => p.id).join(",")}`);

  const sped = await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: { preset: "speed" },
  });
  if (sped.preset !== "speed" || sped.weights.response !== 40) {
    throw new Error("speed preset not applied");
  }
  steps.push("preset speed applied");

  const audit = await apiOk("/api/admin/audit-logs?limit=10", { token: admin.token });
  const hit = (audit.logs || []).find((l) => l.action === "match_weights_update");
  if (!hit) throw new Error("audit match_weights_update missing");
  steps.push(`audit ${hit.action}`);

  const restored = await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: { preset: "balanced" },
  });
  if (restored.preset !== "balanced") throw new Error("balanced restore failed");
  steps.push("preset balanced restored");

  // --- Shortlist notes/tags ---
  await apiOk("/api/favorites", {
    method: "POST",
    token: home.token,
    body: { targetType: "pro", targetId: pro.user.id },
  });
  const patched = await apiOk("/api/favorites", {
    method: "PATCH",
    token: home.token,
    body: {
      targetType: "pro",
      targetId: pro.user.id,
      notes: "Wave14 kitchen shortlist",
      tags: ["kitchen", "wave14"],
    },
  });
  if (patched.favorite?.notes !== "Wave14 kitchen shortlist") {
    throw new Error("notes not saved");
  }
  if (!Array.isArray(patched.favorite.tags) || !patched.favorite.tags.includes("kitchen")) {
    throw new Error("tags not saved");
  }
  steps.push("shortlist notes/tags ok");

  // home2 also shortlists for soft notify path
  await apiOk("/api/favorites", {
    method: "POST",
    token: home2.token,
    body: { targetType: "pro", targetId: pro.user.id },
  });
  steps.push("home2 shortlisted pro");

  const favs = await apiOk("/api/favorites?type=pro", { token: home.token });
  const favPro = (favs.favorites || []).find((f) => f.targetId === pro.user.id);
  if (!favPro?.notes) throw new Error("list favorites missing notes");
  steps.push("list favorites includes notes");

  // --- Job + bulk invite from shortlist ---
  const created = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave14 SLA shortlist smoke",
      description: "Wave 14 smoke for SLA trends, shortlist notes, presets, Find Pros SLA filter.",
      category: "plumbing",
      city: "Bengaluru",
      area: "Koramangala",
      budgetMin: 2500,
      budgetMax: 7000,
      maxBids: 5,
      lat: 12.9352,
      lng: 77.6245,
    },
  });
  const jobId = created.job?.id;
  if (!jobId) throw new Error("job create failed");
  steps.push(`job ${jobId}`);

  const bulk = await apiOk(`/api/jobs/${jobId}/invite-pros`, {
    method: "POST",
    token: home.token,
    body: {
      tradespersonIds: [pro.user.id],
      message: "Wave14 bulk shortlist invite",
    },
  });
  if (!bulk.sent && bulk.sent !== 0) throw new Error("bulk invite shape bad");
  steps.push(`bulk invite sent=${bulk.sent} failed=${bulk.failed}`);

  await apiOk(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    token: pro.token,
    body: {
      amount: 4800,
      message: "wave14 reply bid",
      etaDays: 1,
      quoteAmount: 4500,
    },
  });
  steps.push("bid placed");

  const bids = await apiOk(`/api/jobs/${jobId}/bids`, { token: home.token });
  const bid = (bids.bids || []).find((b) => b.tradespersonId === pro.user.id);
  if (!bid) throw new Error("bid missing");
  assertSla(bid.responseSla, "bid");
  // trends may be clean from seed history
  if (bid.proSlaTrends && bid.proSlaTrends.clean) {
    assertSla(bid.proSlaTrends.d7, "bid.d7");
    assertSla(bid.proSlaTrends.d30, "bid.d30");
    steps.push(`bid trends clean d7=${bid.proSlaTrends.d7.tier} d30=${bid.proSlaTrends.d30.tier}`);
  } else {
    steps.push("bid trends not clean yet (ok)");
  }

  // --- Pro analytics SLA trends ---
  const analytics = await apiOk("/api/profile/analytics", { token: pro.token });
  const a = analytics.analytics;
  assertSla(a.responseSla, "analytics");
  if (!a.slaTrends?.d7 || !a.slaTrends?.d30) throw new Error("slaTrends missing");
  assertSla(a.slaTrends.d7, "analytics.d7");
  assertSla(a.slaTrends.d30, "analytics.d30");
  steps.push(
    `analytics trends d7=${a.slaTrends.d7.tier}(n=${a.slaTrends.d7.sampleSize}) d30=${a.slaTrends.d30.tier} clean=${a.slaTrends.clean}`
  );

  // --- Find Pros SLA filter ---
  const browse = await apiOk("/api/profile/browse?slaTier=same_day_or_better", {
    token: home.token,
  });
  if (!Array.isArray(browse.pros)) throw new Error("browse pros missing");
  for (const p of browse.pros) {
    if (!p.responseSla) throw new Error("browse pro missing responseSla");
    if (!["lightning", "fast", "same_day"].includes(p.responseSla.tier)) {
      throw new Error(`browse filter leaked tier ${p.responseSla.tier}`);
    }
  }
  steps.push(`browse same_day_or_better count=${browse.pros.length}`);

  const browseMax = await apiOk("/api/profile/browse?maxResponseHours=48", {
    token: home.token,
  });
  for (const p of browseMax.pros) {
    if (p.responseSla?.hours != null && p.responseSla.hours > 48) {
      throw new Error("maxResponseHours filter leaked");
    }
  }
  steps.push(`browse maxResponseHours=48 count=${browseMax.pros.length}`);

  console.log("wave14:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave14:smoke FAIL", e.message || e);
  process.exit(1);
});
