/**
 * Wave 19 API smoke: counter analytics + time-to-address SLA,
 * heat-aware suggested-pros, escrow what-if, counter templates,
 * configurable nudge hours.
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

  const nudged = await apiOk("/api/auth/me", {
    method: "PATCH",
    token: pro.token,
    body: { quoteViewNudgeHours: 6 },
  });
  if (Number(nudged.user?.quoteViewNudgeHours) !== 6) {
    throw new Error(`expected quoteViewNudgeHours=6 got ${nudged.user?.quoteViewNudgeHours}`);
  }
  steps.push("pro nudge hours=6");

  const tpls = [
    {
      id: "smoke-busy",
      label: "Busy",
      body: "Booked this week — wave19 smoke.",
      createdAt: new Date().toISOString(),
    },
    {
      id: "smoke-floor",
      label: "Floor",
      body: "I won't go below ₹X for this scope (wave19).",
      createdAt: new Date().toISOString(),
    },
  ];
  const tplSave = await apiOk("/api/auth/me", {
    method: "PATCH",
    token: pro.token,
    body: { counterTemplates: tpls },
  });
  if (!Array.isArray(tplSave.user?.counterTemplates) || tplSave.user.counterTemplates.length < 2) {
    throw new Error("counterTemplates not persisted");
  }
  steps.push(`counter templates n=${tplSave.user.counterTemplates.length}`);

  const created = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave19 counter analytics + what-if + heat",
      description: "Wave 19 smoke for analytics, heat-aware suggestions, escrow what-if, templates, nudge.",
      category: "plumbing",
      city: "Bengaluru",
      area: "Indiranagar",
      budgetMin: 2000,
      budgetMax: 9000,
      maxBids: 8,
      lat: 12.9784,
      lng: 77.6408,
    },
  });
  const jobId = created.job?.id;
  if (!jobId) throw new Error("job create failed");
  steps.push(`job ${jobId}`);

  const placed = await apiOk(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    token: pro.token,
    body: {
      amount: 6200,
      message: "wave19 bid",
      etaDays: 2,
      quoteAmount: 6000,
      quoteNotes: "Initial wave19 quote",
    },
  });
  const bidId = placed.bid?.id;
  if (!bidId) throw new Error("bid missing");
  steps.push(`bid ${bidId}`);

  await apiOk(`/api/bids/${bidId}/counter-offer`, {
    method: "POST",
    token: home.token,
    body: { suggestedAmount: 5400, notes: "Wave19 counter for SLA" },
  });
  steps.push("counter pending");
  await new Promise((r) => setTimeout(r, 50));

  await apiOk(`/api/bids/${bidId}/quote`, {
    method: "PATCH",
    token: pro.token,
    body: { quoteAmount: 5500, quoteNotes: "Addressed wave19 counter" },
  });
  const bidsAfter = await apiOk(`/api/jobs/${jobId}/bids`, { token: home.token });
  const row = (bidsAfter.bids || []).find((b) => b.id === bidId);
  if (row?.counterOffer?.status !== "addressed") {
    throw new Error(`expected addressed got ${row?.counterOffer?.status}`);
  }
  if (!row?.counterOffer?.addressedAt) {
    throw new Error("addressedAt missing on counterOffer");
  }
  steps.push(`counter addressedAt=${row.counterOffer.addressedAt}`);

  const whatIf = await apiOk(`/api/bids/${bidId}/escrow-what-if?amount=5500`, {
    token: home.token,
  });
  if (Number(whatIf.amount) !== 5500) throw new Error("what-if amount mismatch");
  if (!Array.isArray(whatIf.milestones) || whatIf.milestones.length !== 3) {
    throw new Error("expected 3 milestone what-if rows");
  }
  const labels = whatIf.milestones.map((m) => m.label).join(",");
  if (labels !== "Deposit,Progress,Completion") {
    throw new Error(`unexpected milestone labels ${labels}`);
  }
  const sum = whatIf.milestones.reduce((s, m) => s + Number(m.amount), 0);
  if (Math.abs(sum - 5500) > 0.02) throw new Error(`milestone sum ${sum} != 5500`);
  steps.push(`escrow what-if Deposit₹${whatIf.milestones[0].amount} + … = ₹${sum}`);

  const accepted = await apiOk(`/api/bids/${bidId}/accept`, {
    method: "POST",
    token: home.token,
  });
  if (Number(accepted.escrow?.amount) !== 5500) {
    throw new Error(`accept escrow expected 5500 got ${accepted.escrow?.amount}`);
  }
  steps.push("bid accepted after address");

  const job2 = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave19 counter decline analytics",
      description: "Decline path",
      category: "electrical",
      city: "Bengaluru",
      area: "Whitefield",
      budgetMin: 1000,
      budgetMax: 5000,
      maxBids: 5,
      lat: 12.9698,
      lng: 77.75,
    },
  });
  const job2Id = job2.job?.id;
  const bid2 = await apiOk(`/api/jobs/${job2Id}/bids`, {
    method: "POST",
    token: pro.token,
    body: { amount: 3200, quoteAmount: 3000, quoteNotes: "wave19 decline path" },
  });
  const bid2Id = bid2.bid?.id;
  await apiOk(`/api/bids/${bid2Id}/counter-offer`, {
    method: "POST",
    token: home.token,
    body: { suggestedAmount: 2500, notes: "too low wave19" },
  });
  await apiOk(`/api/bids/${bid2Id}/counter-offer/decline`, {
    method: "POST",
    token: pro.token,
    body: { notes: tpls[1].body.replace("₹X", "₹2800") },
  });
  steps.push("counter declined with template note");

  const homeStats = await apiOk("/api/jobs/counter-analytics", { token: home.token });
  if (homeStats.sent < 2) throw new Error(`home sent expected >=2 got ${homeStats.sent}`);
  if (homeStats.addressed < 1) throw new Error("home addressed < 1");
  if (homeStats.declined < 1) throw new Error("home declined < 1");
  if (homeStats.addressSampleSize === 0) {
    throw new Error("expected addressSampleSize >= 1");
  }
  steps.push(
    `home analytics sent=${homeStats.sent} addressed=${homeStats.addressed} declined=${homeStats.declined} avgAddress=${homeStats.avgTimeToAddressHours}h afterAccept=${homeStats.afterAddressedAccepted}`
  );

  const proStats = await apiOk("/api/profile/counter-analytics", { token: pro.token });
  if (proStats.sent < 2) throw new Error(`pro sent expected >=2 got ${proStats.sent}`);
  if (proStats.declined < 1) throw new Error("pro declined < 1");
  steps.push(
    `pro analytics sent=${proStats.sent} addressRate=${proStats.addressRate}% declineRate=${proStats.declineRate}%`
  );

  const job3 = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave19 heat-aware suggestions",
      description: "Open job for suggested-pros heat rank",
      category: "plumbing",
      city: "Bengaluru",
      area: "Koramangala",
      budgetMin: 1500,
      budgetMax: 7000,
      maxBids: 5,
      lat: 12.9352,
      lng: 77.6245,
    },
  });
  const job3Id = job3.job?.id;
  const sug = await apiOk(`/api/jobs/${job3Id}/suggested-pros?limit=5`, {
    token: home.token,
  });
  if (!sug.heatAware) throw new Error("heatAware flag missing");
  const list = sug.suggestions || [];
  if (!list.length) throw new Error("no suggestions");
  for (const s of list) {
    if (s.availabilityHeat == null) throw new Error("availabilityHeat missing on suggestion");
    if (s.rankedScore == null) throw new Error("rankedScore missing");
    if (s.heatBoost == null) throw new Error("heatBoost missing");
  }
  for (let i = 1; i < list.length; i++) {
    if (list[i - 1].rankedScore < list[i].rankedScore) {
      throw new Error(
        `rankedScore not descending: ${list[i - 1].rankedScore} < ${list[i].rankedScore}`
      );
    }
  }
  steps.push(
    `suggested heatAware n=${list.length} top ranked=${list[0].rankedScore} heatBoost=${list[0].heatBoost}`
  );

  const job4 = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave19 nudge hours",
      description: "nudge threshold",
      category: "carpentry",
      city: "Bengaluru",
      area: "Jayanagar",
      budgetMin: 1000,
      budgetMax: 4000,
      maxBids: 4,
      lat: 12.9308,
      lng: 77.5838,
    },
  });
  const job4Id = job4.job?.id;
  const bid4 = await apiOk(`/api/jobs/${job4Id}/bids`, {
    method: "POST",
    token: pro.token,
    body: { amount: 2500, quoteAmount: 2400, quoteNotes: "nudge base" },
  });
  const bid4Id = bid4.bid?.id;
  await apiOk(`/api/bids/${bid4Id}/quote`, {
    method: "PATCH",
    token: pro.token,
    body: { quoteAmount: 2300, quoteNotes: "revised for nudge" },
  });
  await apiOk(`/api/bids/${bid4Id}/quote-viewed`, {
    method: "POST",
    token: home.token,
  });
  const soft = await apiOk(`/api/bids/${bid4Id}/viewed-no-reply?forceHours=5`, {
    method: "POST",
    token: pro.token,
  });
  if (soft.viewedNoReply?.thresholdHours !== 6) {
    throw new Error(`expected thresholdHours=6 got ${soft.viewedNoReply?.thresholdHours}`);
  }
  if (soft.viewedNoReply?.due === true) {
    throw new Error("forceHours=5 should not be due when threshold=6");
  }
  steps.push("nudge threshold respects quoteViewNudgeHours=6");

  const hard = await apiOk(`/api/bids/${bid4Id}/viewed-no-reply?forceHours=7&force=1`, {
    method: "POST",
    token: pro.token,
  });
  if (!hard.viewedNoReply?.due) throw new Error("forceHours=7 should be due");
  if (!hard.viewedNoReply?.nudged) throw new Error("expected nudged on force");
  steps.push("nudge fires at forceHours=7 with threshold=6");

  console.log("wave19:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave19:smoke FAIL", e.message || e);
  process.exit(1);
});
