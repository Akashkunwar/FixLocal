/**
 * Wave 20 API smoke: admin heat weight, escrow what-if on compare amounts,
 * per-job counter analytics, counter decline with template note.
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

function previewEscrowSplit(totalAmount) {
  const total = Math.round(Number(totalAmount) * 100) / 100;
  const tmpl = [
    { label: "Deposit", percent: 30 },
    { label: "Progress", percent: 40 },
    { label: "Completion", percent: 30 },
  ];
  const milestones = [];
  let allocated = 0;
  for (let i = 0; i < tmpl.length; i++) {
    const isLast = i === tmpl.length - 1;
    const amount = isLast
      ? Math.round((total - allocated) * 100) / 100
      : Math.round(((total * tmpl[i].percent) / 100) * 100) / 100;
    allocated += amount;
    milestones.push({ ...tmpl[i], sequence: i + 1, amount });
  }
  return { amount: total, milestones };
}

async function main() {
  const steps = [];
  const admin = await login("admin@fixlocal.local");
  const home = await login("home@fixlocal.local");
  const pro = await login("pro@fixlocal.local");
  const pro2 = await login("pro2@fixlocal.local");

  const before = await apiOk("/api/admin/match-weights", { token: admin.token });
  const prevHeat = Number(before.heatWeight ?? 10);
  steps.push(`heatWeight before=${prevHeat}`);

  const set15 = await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: { weights: before.weights, heatWeight: 15 },
  });
  if (Number(set15.heatWeight) !== 15) {
    throw new Error(`expected heatWeight=15 got ${set15.heatWeight}`);
  }
  steps.push("admin set heatWeight=15");

  const job = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave20 heat + what-if + counter analytics",
      description: "Wave 20 smoke job",
      category: "plumbing",
      city: "Bengaluru",
      area: "Indiranagar",
      budgetMin: 2000,
      budgetMax: 10000,
      maxBids: 8,
      lat: 12.9784,
      lng: 77.6408,
    },
  });
  const jobId = job.job?.id;
  if (!jobId) throw new Error("job create failed");
  steps.push(`job ${jobId}`);

  const sug = await apiOk(`/api/jobs/${jobId}/suggested-pros?limit=5`, {
    token: home.token,
  });
  if (Number(sug.heatWeight) !== 15) {
    throw new Error(`suggested-pros heatWeight expected 15 got ${sug.heatWeight}`);
  }
  const list = sug.suggestions || [];
  if (!list.length) throw new Error("no suggestions");
  for (const s of list) {
    if (s.heatBoost == null) throw new Error("heatBoost missing");
    if (s.availabilityHeat?.clean) {
      const expected = Math.min(
        15,
        Math.round((Number(s.availabilityHeat.score || 0) * 15) / 100)
      );
      if (Number(s.heatBoost) !== expected) {
        throw new Error(
          `heatBoost ${s.heatBoost} != expected ${expected} for score ${s.availabilityHeat.score}`
        );
      }
    } else if (Number(s.heatBoost) !== 0) {
      throw new Error(`unclean should heatBoost=0 got ${s.heatBoost}`);
    }
  }
  steps.push(
    `suggested heatWeight=15 n=${list.length} topBoost=${list[0].heatBoost}`
  );

  const bid1 = await apiOk(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    token: pro.token,
    body: {
      amount: 7000,
      message: "wave20 a",
      etaDays: 2,
      quoteAmount: 6800,
      quoteNotes: "wave20 quote a",
    },
  });
  const bid1Id = bid1.bid?.id;
  const bid2 = await apiOk(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    token: pro2.token,
    body: {
      amount: 6500,
      message: "wave20 b",
      etaDays: 3,
      quoteAmount: 6200,
      quoteNotes: "wave20 quote b",
    },
  });
  const bid2Id = bid2.bid?.id;
  if (!bid1Id || !bid2Id) throw new Error("bids missing");
  steps.push(`competing bids ${bid1Id.slice(0, 8)} / ${bid2Id.slice(0, 8)}`);

  const w1 = await apiOk(`/api/bids/${bid1Id}/escrow-what-if?amount=6800`, {
    token: home.token,
  });
  const w2 = await apiOk(`/api/bids/${bid2Id}/escrow-what-if?amount=6200`, {
    token: home.token,
  });
  const local1 = previewEscrowSplit(6800);
  const local2 = previewEscrowSplit(6200);
  for (const [apiW, local, label] of [
    [w1, local1, "bid1"],
    [w2, local2, "bid2"],
  ]) {
    if (!Array.isArray(apiW.milestones) || apiW.milestones.length !== 3) {
      throw new Error(`${label} milestones missing`);
    }
    for (let i = 0; i < 3; i++) {
      if (Math.abs(Number(apiW.milestones[i].amount) - local.milestones[i].amount) > 0.02) {
        throw new Error(`${label} milestone ${i} mismatch`);
      }
    }
  }
  // Side-by-side clean: both holds positive, 3 milestones, Deposit differs
  if (w1.milestones[0].amount === w2.milestones[0].amount) {
    throw new Error("expected different Deposit amounts for side-by-side");
  }
  steps.push(
    `what-if side-by-side Deposit ₹${w1.milestones[0].amount} vs ₹${w2.milestones[0].amount}`
  );

  await apiOk(`/api/bids/${bid1Id}/counter-offer`, {
    method: "POST",
    token: home.token,
    body: { suggestedAmount: 6000, notes: "Wave20 per-job counter" },
  });
  await apiOk(`/api/bids/${bid1Id}/quote`, {
    method: "PATCH",
    token: pro.token,
    body: { quoteAmount: 6100, quoteNotes: "Addressed wave20" },
  });
  await apiOk(`/api/bids/${bid2Id}/counter-offer`, {
    method: "POST",
    token: home.token,
    body: { suggestedAmount: 5500, notes: "Wave20 decline path" },
  });
  await apiOk(`/api/bids/${bid2Id}/counter-offer/decline`, {
    method: "POST",
    token: pro2.token,
    body: {
      notes:
        "I won't go below ₹5800 for this scope — that's my floor after materials and travel. Happy to adjust scope if needed.",
    },
  });
  steps.push("counter addressed + declined with template-style note");

  const perJob = await apiOk(`/api/bids/counter-analytics?jobId=${jobId}`, {
    token: home.token,
  });
  if (perJob.jobId !== jobId) throw new Error(`jobId mismatch ${perJob.jobId}`);
  if (perJob.sent < 2) throw new Error(`per-job sent expected >=2 got ${perJob.sent}`);
  if (perJob.addressed < 1) throw new Error("per-job addressed < 1");
  if (perJob.declined < 1) throw new Error("per-job declined < 1");
  steps.push(
    `per-job analytics sent=${perJob.sent} addressed=${perJob.addressed} declined=${perJob.declined}`
  );

  // Restore prior heat weight
  await apiOk("/api/admin/match-weights", {
    method: "PUT",
    token: admin.token,
    body: { weights: before.weights, heatWeight: prevHeat },
  });
  steps.push(`restored heatWeight=${prevHeat}`);

  console.log("wave20:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave20:smoke FAIL", e.message || e);
  process.exit(1);
});
