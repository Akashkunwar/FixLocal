/**
 * Wave 12 API smoke: invite analytics, invite-opened tracking, bid-after-invite,
 * not-interested soft-skip, invite templates on User, invoice parties still ok.
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
  const pro2 = await login("pro2@fixlocal.local");

  // Save invite templates on user
  const tpl = [
    {
      id: "wave12-tpl",
      label: "Wave12",
      body: "Wave12 smoke template — flexible this week.",
      createdAt: new Date().toISOString(),
    },
  ];
  const me = await apiOk("/api/auth/me", {
    method: "PATCH",
    token: home.token,
    body: { inviteTemplates: tpl },
  });
  if (!Array.isArray(me.user?.inviteTemplates) || !me.user.inviteTemplates.length) {
    throw new Error("inviteTemplates not persisted on user");
  }
  steps.push(`inviteTemplates ${me.user.inviteTemplates.length}`);

  // Pro marks painting as not interested (pro2 is electrical — use painting skip)
  await apiOk("/api/profile", {
    method: "PATCH",
    token: pro2.token,
    body: { notInterestedCategories: ["plumbing"] },
  });
  steps.push("pro2 notInterested=plumbing");

  const created = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave12 invite analytics smoke",
      description: "Wave 12 smoke for analytics, open tracking, templates, not-interested.",
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

  const sug = await apiOk(`/api/jobs/${jobId}/suggested-pros?limit=8`, {
    token: home.token,
  });
  const ids = (sug.suggestions || []).map((s) => s.userId);
  if (ids.includes(pro2.user.id)) {
    throw new Error("pro2 should be soft-skipped for plumbing suggestions");
  }
  if (typeof sug.skippedNotInterested !== "number") {
    throw new Error("skippedNotInterested missing on suggested-pros");
  }
  steps.push(`soft-skip ok skipped=${sug.skippedNotInterested}`);

  // Invite pro (plumbing specialist)
  const inv = await apiOk(`/api/jobs/${jobId}/invite-pro`, {
    method: "POST",
    token: home.token,
    body: {
      tradespersonId: pro.user.id,
      message: "Wave12 analytics invite",
    },
  });
  if (!inv.ok) throw new Error("invite failed");
  steps.push("invite sent to pro");

  // Pro opens invite deep-link tracking
  const opened = await apiOk(`/api/jobs/${jobId}/invite-opened`, {
    method: "POST",
    token: pro.token,
  });
  if (!opened.openedAt || !opened.clickedAt) {
    throw new Error("invite-opened missing timestamps");
  }
  steps.push(`invite opened firstOpen=${opened.firstOpen}`);

  // Analytics after open
  let analytics = await apiOk(`/api/jobs/${jobId}/invite-analytics`, {
    token: home.token,
  });
  if (analytics.sent < 1) throw new Error("analytics.sent expected >=1");
  if (analytics.opened < 1) throw new Error("analytics.opened expected >=1");
  if (analytics.clicked < 1) throw new Error("analytics.clicked expected >=1");
  steps.push(
    `analytics sent=${analytics.sent} opened=${analytics.opened} clicked=${analytics.clicked}`
  );

  // Bid after invite
  await apiOk(`/api/jobs/${jobId}/bids`, {
    method: "POST",
    token: pro.token,
    body: {
      amount: 4800,
      message: "wave12 bid after invite",
      etaDays: 2,
      quoteAmount: 4500,
      quoteNotes: "wave12 quote",
    },
  });
  analytics = await apiOk(`/api/jobs/${jobId}/invite-analytics`, {
    token: home.token,
  });
  if (analytics.bidAfterInvite < 1) {
    throw new Error("bidAfterInvite expected >=1");
  }
  steps.push(`bidAfterInvite=${analytics.bidAfterInvite} bidRate=${analytics.bidRate}`);

  const hist = await apiOk(`/api/jobs/${jobId}/invites`, { token: home.token });
  const row = hist.invites.find((i) => i.tradespersonId === pro.user.id);
  if (!row?.opened || !row.bidAfterInvite) {
    throw new Error("invite history missing opened/bidAfterInvite flags");
  }
  steps.push("history flags opened+bidAfterInvite");

  // Homeowner aggregate
  const agg = await apiOk("/api/jobs/invite-analytics", { token: home.token });
  if (agg.sent < 1) throw new Error("aggregate sent expected");
  steps.push(`aggregate sent=${agg.sent} jobs=${agg.jobs}`);

  // Score breakdown still present for explainability
  const sug2 = await apiOk(`/api/jobs/${jobId}/suggested-pros?limit=3`, {
    token: home.token,
  });
  const top = sug2.suggestions?.[0];
  if (!top?.breakdown || top.breakdown.skills == null || top.breakdown.rating == null) {
    throw new Error("match breakdown missing sk/rt fields");
  }
  if (top.breakdown.response == null || top.breakdown.distance == null) {
    throw new Error("match breakdown missing rs/ds fields");
  }
  steps.push(
    `score explain sk${top.breakdown.skills} rt${top.breakdown.rating} rs${top.breakdown.response} ds${top.breakdown.distance}`
  );

  // Reset pro2 prefs so later waves aren't polluted
  await apiOk("/api/profile", {
    method: "PATCH",
    token: pro2.token,
    body: { notInterestedCategories: [] },
  });
  steps.push("pro2 notInterested cleared");

  console.log("wave12:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave12:smoke FAIL", e.message || e);
  process.exit(1);
});
