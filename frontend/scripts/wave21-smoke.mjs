/**
 * Wave 21 API smoke: heat in match presets + audit rollback snapshots,
 * admin match-quality heatBoost on top pros, bid list matchScore for best-value,
 * counter negotiation history presence.
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
  const admin = await login("admin@fixlocal.local");
  const home = await login("home@fixlocal.local");
  const pro = await login("pro@fixlocal.local");
  const pro2 = await login("pro2@fixlocal.local");

  const before = await apiOk("/api/admin/match-weights", { token: admin.token });
  const prevWeights = before.weights;
  const prevHeat = Number(before.heatWeight ?? 10);
  steps.push(`baseline heat=${prevHeat} preset=${before.preset || "custom"}`);

  // Presets must expose heatWeight
  const presets = before.presets || [];
  if (!presets.length) throw new Error("no presets returned");
  for (const p of presets) {
    if (p.heatWeight == null || !Number.isFinite(Number(p.heatWeight))) {
      throw new Error(`preset ${p.id} missing heatWeight`);
    }
  }
  const speed = presets.find((p) => p.id === "speed");
  if (!speed) throw new Error("speed preset missing");
  steps.push(
    `presets include heat: ${presets.map((p) => `${p.id}=${p.heatWeight}`).join(", ")}`
  );

  // Apply speed preset → should set heat from preset
  const applied = await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: { preset: "speed" },
  });
  if (Number(applied.heatWeight) !== Number(speed.heatWeight)) {
    throw new Error(
      `speed preset heat expected ${speed.heatWeight} got ${applied.heatWeight}`
    );
  }
  if (applied.preset !== "speed") {
    throw new Error(`expected active preset speed got ${applied.preset}`);
  }
  steps.push(`applied speed → heat=${applied.heatWeight}`);

  // Audit should have before snapshot with heat
  const audit = await apiOk("/api/admin/audit-logs?action=match_weights_update&limit=10", {
    token: admin.token,
  });
  const row = (audit.logs || []).find(
    (l) =>
      l.action === "match_weights_update" &&
      l.meta?.before &&
      !l.meta?.rollback &&
      (l.meta?.afterHeatWeight === Number(speed.heatWeight) ||
        l.meta?.after?.heatWeight === Number(speed.heatWeight))
  );
  if (!row) throw new Error("no clean audit row with heat snapshot after speed preset");
  const beforeHeatSnap =
    row.meta.beforeHeatWeight ?? row.meta.before?.heatWeight;
  if (beforeHeatSnap == null) {
    throw new Error("audit before heat snapshot missing");
  }
  steps.push(
    `audit ${row.id.slice(0, 8)} beforeHeat=${beforeHeatSnap} afterHeat=${
      row.meta.afterHeatWeight ?? row.meta.after?.heatWeight
    }`
  );

  // Rollback should restore heat from before snapshot
  const rolled = await apiOk("/api/admin/match-weights/rollback", {
    method: "POST",
    token: admin.token,
    body: { auditLogId: row.id },
  });
  if (!rolled.ok) throw new Error("rollback failed");
  if (Number(rolled.heatWeight) !== Number(beforeHeatSnap)) {
    throw new Error(
      `rollback heat expected ${beforeHeatSnap} got ${rolled.heatWeight}`
    );
  }
  steps.push(`rollback restored heat=${rolled.heatWeight}`);

  // Admin match-quality top pros include heatBoost
  const mq = await apiOk("/api/admin/match-quality", { token: admin.token });
  if (mq.heatWeight == null) throw new Error("match-quality missing heatWeight");
  const withPros = (mq.jobs || []).find((j) => (j.topPros || []).length > 0);
  if (!withPros) {
    steps.push("match-quality: no open jobs with top pros (soft skip heatBoost assert)");
  } else {
    for (const p of withPros.topPros) {
      if (p.heatBoost == null) throw new Error("topPro missing heatBoost");
      if (p.rankedScore == null) throw new Error("topPro missing rankedScore");
    }
    steps.push(
      `match-quality job "${withPros.title.slice(0, 24)}" top heatBoost=${withPros.topPros[0].heatBoost} ranked=${withPros.topPros[0].rankedScore}`
    );
  }

  // Job + bids → listBids includes matchScore for best-value
  const job = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave21 best-value + counter spark",
      description: "Wave 21 smoke job",
      category: "plumbing",
      city: "Bengaluru",
      area: "Indiranagar",
      budgetMin: 2000,
      budgetMax: 12000,
      maxBids: 8,
      lat: 12.9784,
      lng: 77.6408,
    },
  });
  const jobId = job.job?.id;
  if (!jobId) throw new Error("job create failed");
  steps.push(`job ${jobId}`);

  const bid1 = await apiOk(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    token: pro.token,
    body: {
      amount: 8000,
      message: "Wave21 bid A",
      etaDays: 3,
      quoteAmount: 8000,
      quoteNotes: "Full scope",
    },
  });
  const bid2 = await apiOk(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    token: pro2.token,
    body: {
      amount: 6500,
      message: "Wave21 bid B",
      etaDays: 4,
      quoteAmount: 6500,
      quoteNotes: "Lean scope",
    },
  });
  const bid1Id = bid1.bid?.id;
  const bid2Id = bid2.bid?.id;
  if (!bid1Id || !bid2Id) throw new Error("bids missing ids");
  steps.push(`bids ${bid1Id.slice(0, 8)} / ${bid2Id.slice(0, 8)}`);

  const listed = await apiOk(`/api/jobs/${jobId}/bids`, { token: home.token });
  const listedBids = listed.bids || [];
  if (listedBids.length < 2) throw new Error("expected >=2 bids");
  for (const b of listedBids) {
    if (b.matchScore == null || !Number.isFinite(Number(b.matchScore))) {
      throw new Error(`bid ${b.id} missing matchScore`);
    }
    if (b.rankedScore == null) throw new Error(`bid ${b.id} missing rankedScore`);
    if (b.heatBoost == null) throw new Error(`bid ${b.id} missing heatBoost`);
  }
  steps.push(
    `listBids matchScores=${listedBids.map((b) => b.matchScore).join(",")}`
  );

  // Counters for negotiation timeline data
  await apiOk(`/api/bids/${bid1Id}/counter-offer`, {
    method: "POST",
    token: home.token,
    body: {
      suggestedAmount: 7200,
      notes: "My budget is a bit tighter than this quote — could you revise closer to the suggested amount if we keep the same scope?",
    },
  });
  await apiOk(`/api/bids/${bid1Id}/quote`, {
    method: "PATCH",
    token: pro.token,
    body: { quoteAmount: 7500, quoteNotes: "Revised after counter" },
  });
  await apiOk(`/api/bids/${bid1Id}/counter-offer`, {
    method: "POST",
    token: home.token,
    body: { suggestedAmount: 7000, notes: "Can we meet in the middle?" },
  });
  const afterCounters = await apiOk(`/api/jobs/${jobId}/bids`, { token: home.token });
  const b1 = (afterCounters.bids || []).find((b) => b.id === bid1Id);
  const histLen = (b1?.counterHistory || []).length + (b1?.counterOffer ? 1 : 0);
  if (histLen < 2) throw new Error(`expected counter timeline points >=2 got ${histLen}`);
  steps.push(`counter negotiation points≈${histLen} on bid1`);

  // Restore baseline weights + heat
  await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: { weights: prevWeights, heatWeight: prevHeat },
  });
  steps.push(`restored heat=${prevHeat}`);

  console.log("wave21:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave21:smoke FAIL", e.message || e);
  process.exit(1);
});
