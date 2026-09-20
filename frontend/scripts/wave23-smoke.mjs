/**
 * Wave 23 API smoke:
 * - homeownerCounterTemplates create/edit-style upsert via PATCH /me
 * - best_value_blend audit + rollback (incl. slaHeatPct third weight)
 * - listBids returns blend with slaHeatPct
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
  const prevBlend = before.bestValueBlend || { matchPct: 55, pricePct: 45, slaHeatPct: 0 };
  steps.push(
    `baseline blend=${prevBlend.matchPct}/${prevBlend.pricePct}/${prevBlend.slaHeatPct ?? 0}`
  );

  // Homeowner custom note create/edit-style upsert (Settings path)
  const tpl = [
    {
      id: "ho-wave23-custom",
      label: "Wave23 custom",
      body: "Wave 23 smoke custom counter note — please revise toward my budget.",
      createdAt: new Date().toISOString(),
    },
    {
      id: "ho-budget",
      label: "Budget tight (edited)",
      body: "Wave 23 edited default — budget is tighter; revise closer to my suggestion.",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const patched = await apiOk("/api/auth/me", {
    method: "PATCH",
    token: home.token,
    body: { homeownerCounterTemplates: tpl },
  });
  const saved = patched.user?.homeownerCounterTemplates || [];
  if (!saved.some((t) => t.id === "ho-wave23-custom" && t.body.includes("Wave 23 smoke"))) {
    throw new Error("custom homeowner note not persisted");
  }
  if (!saved.some((t) => t.id === "ho-budget" && t.label.includes("edited"))) {
    throw new Error("edited default homeowner note not persisted");
  }
  steps.push(`homeowner notes upserted (${saved.length})`);

  // Best-value blend with third weight → dedicated audit
  const blended = await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: {
      weights: prevWeights,
      heatWeight: prevHeat,
      bestValueBlend: { matchPct: 50, pricePct: 35, slaHeatPct: 15 },
    },
  });
  if (Number(blended.bestValueBlend?.matchPct) !== 50) {
    throw new Error(`blend matchPct expected 50 got ${JSON.stringify(blended.bestValueBlend)}`);
  }
  if (Number(blended.bestValueBlend?.pricePct) !== 35) {
    throw new Error(`blend pricePct expected 35 got ${JSON.stringify(blended.bestValueBlend)}`);
  }
  if (Number(blended.bestValueBlend?.slaHeatPct) !== 15) {
    throw new Error(`blend slaHeatPct expected 15 got ${JSON.stringify(blended.bestValueBlend)}`);
  }
  steps.push(
    `blend set to ${blended.bestValueBlend.matchPct}/${blended.bestValueBlend.pricePct}/${blended.bestValueBlend.slaHeatPct}`
  );

  const logs = await apiOk("/api/admin/audit-logs?action=best_value_blend_update&limit=20", {
    token: admin.token,
  });
  const row = (logs.logs || []).find(
    (l) =>
      l.action === "best_value_blend_update" &&
      !l.meta?.rollback &&
      Number(l.meta?.after?.slaHeatPct) === 15 &&
      Number(l.meta?.after?.matchPct) === 50
  );
  if (!row) throw new Error("no clean best_value_blend_update audit row with slaHeatPct=15");
  if (!row.meta?.before || row.meta.before.matchPct == null) {
    throw new Error("blend audit missing before snapshot");
  }
  steps.push(`audit blend row ${row.id.slice(0, 8)} before sh=${row.meta.before.slaHeatPct ?? 0}`);

  // Rollback blend to before snapshot
  const rolled = await apiOk("/api/admin/best-value-blend/rollback", {
    method: "POST",
    token: admin.token,
    body: { auditLogId: row.id },
  });
  if (!rolled.ok) throw new Error("blend rollback failed");
  const expectedMatch = Number(row.meta.before.matchPct);
  if (Number(rolled.bestValueBlend?.matchPct) !== expectedMatch) {
    throw new Error(
      `rollback matchPct expected ${expectedMatch} got ${rolled.bestValueBlend?.matchPct}`
    );
  }
  steps.push(
    `rollback restored blend ${rolled.bestValueBlend.matchPct}/${rolled.bestValueBlend.pricePct}/${rolled.bestValueBlend.slaHeatPct ?? 0}`
  );

  // Re-apply third weight for listBids assert, then restore
  await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: {
      weights: prevWeights,
      heatWeight: prevHeat,
      bestValueBlend: { matchPct: 50, pricePct: 35, slaHeatPct: 15 },
    },
  });

  const job = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave23 SLA/heat blend + notes",
      description: "Wave 23 smoke job",
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
      message: "Wave23 bid A",
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
      message: "Wave23 bid B",
      etaDays: 4,
      quoteAmount: 6500,
      quoteNotes: "Lean scope",
    },
  });

  const listed = await apiOk(`/api/jobs/${jobId}/bids`, { token: home.token });
  if (!listed.bestValueBlend) throw new Error("listBids missing bestValueBlend");
  if (Number(listed.bestValueBlend.matchPct) !== 50) {
    throw new Error(`listBids matchPct expected 50 got ${listed.bestValueBlend.matchPct}`);
  }
  if (Number(listed.bestValueBlend.slaHeatPct) !== 15) {
    throw new Error(
      `listBids slaHeatPct expected 15 got ${listed.bestValueBlend.slaHeatPct}`
    );
  }
  if ((listed.bids || []).length < 2) throw new Error("expected >=2 bids");
  for (const b of listed.bids) {
    if (b.matchScore == null) throw new Error(`bid ${b.id} missing matchScore`);
    if (b.heatBoost == null) throw new Error(`bid ${b.id} missing heatBoost`);
    if (!b.responseSla) throw new Error(`bid ${b.id} missing responseSla`);
  }
  steps.push(
    `listBids blend=${listed.bestValueBlend.matchPct}/${listed.bestValueBlend.pricePct}/${listed.bestValueBlend.slaHeatPct}`
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
    body: { homeownerCounterTemplates: [] },
  });
  steps.push(
    `restored blend=${prevBlend.matchPct}/${prevBlend.pricePct}/${prevBlend.slaHeatPct ?? 0}`
  );

  console.log("wave23:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave23:smoke FAIL", e.message || e);
  process.exit(1);
});
