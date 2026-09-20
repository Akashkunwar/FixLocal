/**
 * Wave 13 API smoke: response SLA badges, shortlist (favorites), admin match weights.
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
  const ok = ["lightning", "fast", "same_day", "steady", "slow", "unknown"].includes(sla.tier);
  if (!ok) throw new Error(`${label}: unexpected tier ${sla.tier}`);
}

async function main() {
  const steps = [];
  const home = await login("home@fixlocal.local");
  const pro = await login("pro@fixlocal.local");
  const admin = await login("admin@fixlocal.local");

  // --- Match weights: read defaults, tweak, restore ---
  let mw = await apiOk("/api/admin/match-weights", { token: admin.token });
  if (mw.weights.skills !== 35 || mw.defaults.skills !== 35) {
    // defaults constant should be 35; stored may already be customized — still ok if defaults match
    if (mw.defaults.skills !== 35 || mw.defaults.rating !== 25) {
      throw new Error("default weights expected 35/25/20/20");
    }
  }
  steps.push(`weights read sk${mw.weights.skills} sum=${mw.sum}`);

  const tweaked = await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: { weights: { skills: 40, rating: 20, response: 20, distance: 20 } },
  });
  if (tweaked.weights.skills !== 40 || tweaked.weights.rating !== 20) {
    throw new Error("weights not persisted");
  }
  steps.push(`weights tweaked sk${tweaked.weights.skills}`);

  const restored = await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: { weights: { skills: 35, rating: 25, response: 20, distance: 20 } },
  });
  if (restored.weights.skills !== 35) throw new Error("weights restore failed");
  steps.push("weights restored 35/25/20/20");

  // --- Shortlist via favorites ---
  await apiOk("/api/favorites", {
    method: "POST",
    token: home.token,
    body: { targetType: "pro", targetId: pro.user.id },
  });
  const favs = await apiOk("/api/favorites?type=pro", { token: home.token });
  const hit = (favs.favorites || []).find((f) => f.targetId === pro.user.id);
  if (!hit) throw new Error("shortlist favorite pro missing");
  steps.push(`shortlist pro ${pro.user.id.slice(0, 8)}…`);

  // --- Job + invite + bid → SLA on bids / profile / suggestions ---
  const created = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave13 SLA shortlist smoke",
      description: "Wave 13 smoke for response SLA badges, shortlist, match weights.",
      category: "plumbing",
      city: "Bengaluru",
      area: "Indiranagar",
      budgetMin: 2000,
      budgetMax: 6000,
      maxBids: 5,
      lat: 12.9784,
      lng: 77.6408,
    },
  });
  const jobId = created.job?.id;
  if (!jobId) throw new Error("job create failed");
  steps.push(`job ${jobId}`);

  await apiOk(`/api/jobs/${jobId}/invite-pro`, {
    method: "POST",
    token: home.token,
    body: { tradespersonId: pro.user.id, message: "Wave13 SLA invite" },
  });
  steps.push("invite sent");

  await apiOk(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    token: pro.token,
    body: {
      amount: 4200,
      message: "wave13 fast reply bid",
      etaDays: 1,
      quoteAmount: 4000,
    },
  });
  steps.push("bid placed");

  const bids = await apiOk(`/api/jobs/${jobId}/bids`, { token: home.token });
  const bid = (bids.bids || []).find((b) => b.tradespersonId === pro.user.id);
  if (!bid) throw new Error("bid not listed");
  assertSla(bid.responseSla, "bid");
  if (bid.inviteToBidHours == null && bid.jobToBidHours == null) {
    throw new Error("bid missing invite/job latency hours");
  }
  steps.push(
    `bid SLA ${bid.responseSla.tier} inviteH=${bid.inviteToBidHours} jobH=${bid.jobToBidHours}`
  );

  const pub = await apiOk(`/api/profile/user/${pro.user.id}`, { token: home.token });
  assertSla(pub.responseSla || pub.profile?.responseSla, "public profile");
  steps.push(`profile SLA ${(pub.responseSla || pub.profile.responseSla).tier}`);

  const sug = await apiOk(`/api/jobs/${jobId}/suggested-pros?limit=5`, { token: home.token });
  if (!sug.weights || sug.weights.skills !== 35) {
    throw new Error("suggested-pros missing restored weights");
  }
  const top = sug.suggestions?.[0];
  if (!top?.breakdown?.weights) {
    // weights may be on breakdown from scoreProForJob
    if (!top?.breakdown) throw new Error("suggestion breakdown missing");
  }
  if (top?.responseSla) assertSla(top.responseSla, "suggestion");
  steps.push(`suggested weights sk${sug.weights.skills} topSla=${top?.responseSla?.tier || "n/a"}`);

  const mq = await apiOk("/api/admin/match-quality", { token: admin.token });
  if (!mq.weights || mq.weights.skills !== 35) {
    throw new Error("match-quality missing weights");
  }
  steps.push("match-quality includes weights");

  const analytics = await apiOk("/api/profile/analytics", { token: pro.token });
  assertSla(analytics.analytics?.responseSla, "pro analytics");
  steps.push(`analytics SLA ${analytics.analytics.responseSla.tier}`);

  console.log("wave13:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave13:smoke FAIL", e.message || e);
  process.exit(1);
});
