/** Wave 24 API smoke: invite+pro template upsert, blend presets, live blend preview. */
const API = process.env.API_URL || "http://localhost:3001";
const PASS = process.env.SEED_PASSWORD || "Password123!";

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

async function apiOk(path, opts) {
  const r = await api(path, opts);
  if (!r.ok) {
    throw new Error(
      `${opts?.method || "GET"} ${path} → ${r.status} ${JSON.stringify(r.data)}`
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
  const prevBlend = before.bestValueBlend || { matchPct: 55, pricePct: 45, slaHeatPct: 0 };
  const presets = before.bestValueBlendPresets || [];
  if (!presets.some((p) => p.id === "match_heavy")) {
    throw new Error("missing match_heavy blend preset");
  }
  if (!presets.some((p) => p.id === "price_heavy")) {
    throw new Error("missing price_heavy blend preset");
  }
  if (!presets.some((p) => p.id === "balanced_sla")) {
    throw new Error("missing balanced_sla blend preset");
  }
  steps.push(`blend presets listed (${presets.length})`);

  // Invite template create/edit-style upsert (Settings path)
  const inviteTpl = [
    {
      id: "tpl-wave24-custom",
      label: "Wave24 invite",
      body: "Wave 24 smoke custom invite — please take a look this week.",
      createdAt: new Date().toISOString(),
    },
    {
      id: "starter-flexible",
      label: "Flexible timing (edited)",
      body: "Wave 24 edited default invite — flexible timing, need a reliable pro.",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const homePatched = await apiOk("/api/auth/me", {
    method: "PATCH",
    token: home.token,
    body: { inviteTemplates: inviteTpl },
  });
  const invSaved = homePatched.user?.inviteTemplates || [];
  if (!invSaved.some((t) => t.id === "tpl-wave24-custom" && t.body.includes("Wave 24 smoke"))) {
    throw new Error("custom invite template not persisted");
  }
  if (!invSaved.some((t) => t.id === "starter-flexible" && t.label.includes("edited"))) {
    throw new Error("edited default invite template not persisted");
  }
  steps.push(`invite templates upserted (${invSaved.length})`);

  // Pro counter template create/edit-style upsert
  const ctrTpl = [
    {
      id: "ctr-wave24-custom",
      label: "Wave24 counter",
      body: "Wave 24 smoke custom counter reply — can't meet that floor this week.",
      createdAt: new Date().toISOString(),
    },
    {
      id: "starter-busy",
      label: "Busy this week (edited)",
      body: "Wave 24 edited default — booked solid; happy to revise timing.",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const proPatched = await apiOk("/api/auth/me", {
    method: "PATCH",
    token: pro.token,
    body: { counterTemplates: ctrTpl },
  });
  const ctrSaved = proPatched.user?.counterTemplates || [];
  if (!ctrSaved.some((t) => t.id === "ctr-wave24-custom" && t.body.includes("Wave 24 smoke"))) {
    throw new Error("custom pro counter template not persisted");
  }
  if (!ctrSaved.some((t) => t.id === "starter-busy" && t.label.includes("edited"))) {
    throw new Error("edited default pro counter template not persisted");
  }
  steps.push(`pro counter templates upserted (${ctrSaved.length})`);

  // Apply named blend presets
  const matchHeavy = await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: {
      weights: prevWeights,
      heatWeight: prevHeat,
      bestValueBlendPreset: "match_heavy",
    },
  });
  if (Number(matchHeavy.bestValueBlend?.matchPct) !== 70) {
    throw new Error(`match_heavy expected mt70 got ${JSON.stringify(matchHeavy.bestValueBlend)}`);
  }
  if (matchHeavy.bestValueBlendPreset !== "match_heavy") {
    throw new Error(`expected bestValueBlendPreset match_heavy got ${matchHeavy.bestValueBlendPreset}`);
  }
  steps.push(
    `preset match_heavy → ${matchHeavy.bestValueBlend.matchPct}/${matchHeavy.bestValueBlend.pricePct}/${matchHeavy.bestValueBlend.slaHeatPct ?? 0}`
  );

  const priceHeavy = await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: { bestValueBlendPreset: "price_heavy" },
  });
  if (Number(priceHeavy.bestValueBlend?.pricePct) !== 70) {
    throw new Error(`price_heavy expected px70 got ${JSON.stringify(priceHeavy.bestValueBlend)}`);
  }
  steps.push(
    `preset price_heavy → ${priceHeavy.bestValueBlend.matchPct}/${priceHeavy.bestValueBlend.pricePct}/${priceHeavy.bestValueBlend.slaHeatPct ?? 0}`
  );

  const balanced = await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: { bestValueBlendPreset: "balanced_sla" },
  });
  if (Number(balanced.bestValueBlend?.slaHeatPct) !== 15) {
    throw new Error(`balanced_sla expected sh15 got ${JSON.stringify(balanced.bestValueBlend)}`);
  }
  if (balanced.bestValueBlendPreset !== "balanced_sla") {
    throw new Error(`expected balanced_sla got ${balanced.bestValueBlendPreset}`);
  }
  steps.push(
    `preset balanced_sla → ${balanced.bestValueBlend.matchPct}/${balanced.bestValueBlend.pricePct}/${balanced.bestValueBlend.slaHeatPct}`
  );

  // Seed a job with 2 bids so live preview has a sample
  const job = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave24 blend preview plumbing",
      description: "Wave 24 smoke job for live blend preview",
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

  await apiOk(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    token: pro.token,
    body: {
      amount: 9000,
      message: "Wave24 bid A",
      etaDays: 3,
      quoteAmount: 9000,
      quoteNotes: "Full scope",
    },
  });
  await apiOk(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    token: pro2.token,
    body: {
      amount: 6200,
      message: "Wave24 bid B",
      etaDays: 4,
      quoteAmount: 6200,
      quoteNotes: "Lean scope",
    },
  });
  steps.push(`job ${jobId.slice(0, 8)} with 2 bids`);

  // Live preview (saved balanced_sla) + draft what-if (match-heavy query)
  const previewSaved = await apiOk("/api/admin/best-value-blend/preview?limit=5", {
    token: admin.token,
  });
  if (!Array.isArray(previewSaved.jobs)) throw new Error("preview missing jobs array");
  if (previewSaved.sampleSize < 1) {
    throw new Error(`expected sampleSize>=1 got ${previewSaved.sampleSize}`);
  }
  const hit = (previewSaved.jobs || []).find((j) => j.jobId === jobId);
  if (!hit) throw new Error("preview did not include wave24 job");
  if (!hit.topBids?.length || !hit.bestBidId) {
    throw new Error("preview job missing topBids/bestBidId");
  }
  if (Number(previewSaved.blend?.slaHeatPct) !== 15) {
    throw new Error(`preview blend expected sh15 got ${JSON.stringify(previewSaved.blend)}`);
  }
  steps.push(
    `preview saved sample=${previewSaved.sampleSize} best=${hit.topBids[0]?.name} score=${hit.topBids[0]?.valueScore}`
  );

  const previewDraft = await apiOk(
    "/api/admin/best-value-blend/preview?limit=5&matchPct=70&pricePct=30&slaHeatPct=0",
    { token: admin.token }
  );
  if (Number(previewDraft.blend?.matchPct) !== 70) {
    throw new Error(`draft preview expected mt70 got ${JSON.stringify(previewDraft.blend)}`);
  }
  if (previewDraft.bestValueBlendPreset !== "match_heavy") {
    throw new Error(
      `draft preview preset expected match_heavy got ${previewDraft.bestValueBlendPreset}`
    );
  }
  const hitDraft = (previewDraft.jobs || []).find((j) => j.jobId === jobId);
  if (!hitDraft?.bestBidId) throw new Error("draft preview missing wave24 job ranking");
  steps.push(
    `preview draft match_heavy best=${hitDraft.topBids[0]?.name} score=${hitDraft.topBids[0]?.valueScore}`
  );

  // Restore baseline
  await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: {
      weights: prevWeights,
      heatWeight: prevHeat,
      bestValueBlend: {
        matchPct: prevBlend.matchPct,
        pricePct: prevBlend.pricePct,
        slaHeatPct: prevBlend.slaHeatPct ?? 0,
      },
    },
  });
  await apiOk("/api/auth/me", {
    method: "PATCH",
    token: home.token,
    body: { inviteTemplates: [] },
  });
  await apiOk("/api/auth/me", {
    method: "PATCH",
    token: pro.token,
    body: { counterTemplates: [] },
  });
  steps.push(
    `restored blend=${prevBlend.matchPct}/${prevBlend.pricePct}/${prevBlend.slaHeatPct ?? 0}`
  );

  console.log("wave24:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave24:smoke FAIL", e.message || e);
  process.exit(1);
});
