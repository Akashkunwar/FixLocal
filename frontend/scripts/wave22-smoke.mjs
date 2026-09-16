/**
 * Wave 22 API smoke:
 * - homeownerCounterTemplates persist on User
 * - admin best-value blend weights (matchPct / pricePct)
 * - availability-first match preset (high heat)
 * - listBids returns bestValueBlend for homeowner compare
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
  const prevBlend = before.bestValueBlend || { matchPct: 55, pricePct: 45 };
  steps.push(
    `baseline heat=${prevHeat} blend=${prevBlend.matchPct}/${prevBlend.pricePct} preset=${before.preset || "custom"}`
  );

  // Presets include availability-first with high heat
  const presets = before.presets || [];
  const avail = presets.find((p) => p.id === "availability");
  if (!avail) throw new Error("availability preset missing");
  if (Number(avail.heatWeight) < 18) {
    throw new Error(`availability heat expected high (>=18) got ${avail.heatWeight}`);
  }
  steps.push(
    `presets: ${presets.map((p) => `${p.id}=heat${p.heatWeight}`).join(", ")}`
  );

  const applied = await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: { preset: "availability" },
  });
  if (applied.preset !== "availability") {
    throw new Error(`expected preset availability got ${applied.preset}`);
  }
  if (Number(applied.heatWeight) !== Number(avail.heatWeight)) {
    throw new Error(
      `availability heat expected ${avail.heatWeight} got ${applied.heatWeight}`
    );
  }
  steps.push(`applied availability → heat=${applied.heatWeight}`);

  // Best-value blend tunable
  if (!before.bestValueBlend) throw new Error("bestValueBlend missing on GET match-weights");
  const blended = await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: {
      weights: applied.weights,
      heatWeight: applied.heatWeight,
      bestValueBlend: { matchPct: 70, pricePct: 30 },
    },
  });
  if (Number(blended.bestValueBlend?.matchPct) !== 70) {
    throw new Error(`blend matchPct expected 70 got ${JSON.stringify(blended.bestValueBlend)}`);
  }
  if (Number(blended.bestValueBlend?.pricePct) !== 30) {
    throw new Error(`blend pricePct expected 30 got ${JSON.stringify(blended.bestValueBlend)}`);
  }
  steps.push(
    `bestValueBlend set to ${blended.bestValueBlend.matchPct}/${blended.bestValueBlend.pricePct}`
  );

  // Homeowner counter-note templates persist on User
  const tpl = [
    {
      id: "ho-wave22",
      label: "Wave22 note",
      body: "Wave 22 smoke counter note — please revise closer to my suggested amount.",
      createdAt: new Date().toISOString(),
    },
  ];
  const patched = await apiOk("/api/auth/me", {
    method: "PATCH",
    token: home.token,
    body: { homeownerCounterTemplates: tpl },
  });
  const saved = patched.user?.homeownerCounterTemplates || [];
  if (!saved.some((t) => t.id === "ho-wave22" && t.body.includes("Wave 22 smoke"))) {
    throw new Error("homeownerCounterTemplates not persisted on User");
  }
  const me = await apiOk("/api/auth/me", { token: home.token });
  if (!(me.user?.homeownerCounterTemplates || []).some((t) => t.id === "ho-wave22")) {
    throw new Error("homeownerCounterTemplates missing on GET /me");
  }
  steps.push(`homeownerCounterTemplates persisted (${saved.length})`);

  // Job + bids → listBids includes bestValueBlend
  const job = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave22 best-value blend + avail preset",
      description: "Wave 22 smoke job",
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
      amount: 8000,
      message: "Wave22 bid A",
      etaDays: 3,
      quoteAmount: 8000,
      quoteNotes: "Full scope",
    },
  });
  await apiOk(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    token: pro2.token,
    body: {
      amount: 6500,
      message: "Wave22 bid B",
      etaDays: 4,
      quoteAmount: 6500,
      quoteNotes: "Lean scope",
    },
  });

  const listed = await apiOk(`/api/jobs/${jobId}/bids`, { token: home.token });
  if (!listed.bestValueBlend) throw new Error("listBids missing bestValueBlend");
  if (Number(listed.bestValueBlend.matchPct) !== 70) {
    throw new Error(
      `listBids blend matchPct expected 70 got ${listed.bestValueBlend.matchPct}`
    );
  }
  if ((listed.bids || []).length < 2) throw new Error("expected >=2 bids");
  for (const b of listed.bids) {
    if (b.matchScore == null) throw new Error(`bid ${b.id} missing matchScore`);
  }
  steps.push(
    `listBids bestValueBlend=${listed.bestValueBlend.matchPct}/${listed.bestValueBlend.pricePct}`
  );

  // Soft counter on one bid (for peer-hint / sparkline data path)
  const bid1Id = listed.bids[0].id;
  await apiOk(`/api/bids/${bid1Id}/counter-offer`, {
    method: "POST",
    token: home.token,
    body: {
      suggestedAmount: 7000,
      notes: tpl[0].body,
    },
  });
  steps.push(`counter-offer on ${bid1Id.slice(0, 8)} with persisted note template body`);

  // Restore baseline
  await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: {
      weights: prevWeights,
      heatWeight: prevHeat,
      bestValueBlend: prevBlend,
    },
  });
  // Clear smoke templates (optional soft)
  await apiOk("/api/auth/me", {
    method: "PATCH",
    token: home.token,
    body: { homeownerCounterTemplates: [] },
  });
  steps.push(`restored heat=${prevHeat} blend=${prevBlend.matchPct}/${prevBlend.pricePct}`);

  console.log("wave22:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave22:smoke FAIL", e.message || e);
  process.exit(1);
});
