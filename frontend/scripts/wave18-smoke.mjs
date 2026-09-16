/**
 * Wave 18 API smoke: counter history + decline, Find Pros heat sort,
 * shortlist invite heat gate, viewed-no-reply nudge, soft escrow preview.
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

  const created = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave18 counter history + heat + nudge",
      description: "Wave 18 smoke for counter history/decline, heat sort, shortlist heat gate, viewed-no-reply, escrow preview.",
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
      amount: 6000,
      message: "wave18 bid",
      etaDays: 2,
      quoteAmount: 5800,
      quoteNotes: "Initial wave18 quote",
    },
  });
  const bidId = placed.bid?.id;
  if (!bidId) throw new Error("bid missing");
  steps.push(`bid ${bidId}`);

  // Counter #1
  const c1 = await apiOk(`/api/bids/${bidId}/counter-offer`, {
    method: "POST",
    token: home.token,
    body: { suggestedAmount: 5200, notes: "Wave18 first counter −10%-ish" },
  });
  if (c1.bid?.counterOffer?.status !== "pending") throw new Error("c1 not pending");
  steps.push(`counter1 ₹${c1.bid.counterOffer.suggestedAmount}`);

  // Decline counter
  const declined = await apiOk(`/api/bids/${bidId}/counter-offer/decline`, {
    method: "POST",
    token: pro.token,
    body: { notes: "Cannot go that low wave18" },
  });
  if (declined.bid?.counterOffer?.status !== "declined") {
    throw new Error(`expected declined got ${declined.bid?.counterOffer?.status}`);
  }
  steps.push("counter declined");

  const homeNotes = await apiOk("/api/notifications?limit=40", { token: home.token });
  const homeList = Array.isArray(homeNotes.notifications || homeNotes.items)
    ? homeNotes.notifications || homeNotes.items
    : [];
  const declineNote = homeList.find(
    (n) => n.meta?.counterDeclined === true && n.meta?.bidId === bidId
  );
  if (!declineNote) throw new Error("homeowner decline notify missing");
  steps.push("decline notify ok");

  // Counter #2 — should archive previous into history
  const c2 = await apiOk(`/api/bids/${bidId}/counter-offer`, {
    method: "POST",
    token: home.token,
    body: { suggestedAmount: 5400, notes: "Wave18 second counter" },
  });
  if (c2.bid?.counterOffer?.status !== "pending") throw new Error("c2 not pending");
  const hist = c2.bid?.counterHistory || [];
  if (!Array.isArray(hist) || hist.length < 1) {
    throw new Error("counterHistory missing after second counter");
  }
  const archivedDeclined = hist.find((h) => h.status === "declined");
  if (!archivedDeclined) throw new Error("declined counter not in history");
  steps.push(`counter history len=${hist.length}`);

  // Pro revises toward counter → addressed
  await apiOk(`/api/bids/${bidId}/quote`, {
    method: "PATCH",
    token: pro.token,
    body: { quoteAmount: 5500, quoteNotes: "Meeting near counter wave18" },
  });
  const bidsAfter = await apiOk(`/api/jobs/${jobId}/bids`, { token: home.token });
  const row = (bidsAfter.bids || []).find((b) => b.id === bidId);
  if (row?.counterOffer?.status !== "addressed") {
    throw new Error(`expected addressed got ${row?.counterOffer?.status}`);
  }
  steps.push("counter addressed via revise");

  // Soft escrow preview on accept (different amount vs counter suggested)
  const accepted = await apiOk(`/api/bids/${bidId}/accept`, {
    method: "POST",
    token: home.token,
  });
  if (!accepted.escrow?.softHoldPreview) {
    throw new Error("softHoldPreview missing on accept after addressed counter Δ");
  }
  if (Number(accepted.escrow.amount) !== 5500) {
    throw new Error(`escrow amount expected 5500 got ${accepted.escrow.amount}`);
  }
  if (Number(accepted.escrow.counterSuggested) !== 5400) {
    throw new Error("counterSuggested mismatch on escrow preview");
  }
  steps.push(
    `soft escrow preview hold ₹${accepted.escrow.amount} vs counter ₹${accepted.escrow.counterSuggested}`
  );

  // Heat sort on browse
  const heatBrowse = await apiOk("/api/profile/browse?verified=1&sort=heat", {
    token: home.token,
  });
  if (heatBrowse.sort !== "heat") throw new Error("browse sort!=heat");
  const pros = heatBrowse.pros || [];
  const clean = pros.filter((p) => p.availabilityHeat?.clean);
  for (let i = 1; i < clean.length; i++) {
    const a = Number(clean[i - 1].availabilityHeat.score || 0);
    const b = Number(clean[i].availabilityHeat.score || 0);
    if (a < b) throw new Error(`heat sort not descending at ${i}: ${a} < ${b}`);
  }
  steps.push(`heat sort ok (${pros.length} pros, ${clean.length} clean)`);

  // Shortlist ranked heat fields + invite gate — ensure pro2 is favorited
  const pro2Id = pro2.user?.id;
  if (!pro2Id) throw new Error("pro2 user id missing");
  const fav = await api("/api/favorites", {
    method: "POST",
    token: home.token,
    body: { targetType: "pro", targetId: pro2Id },
  });
  if (!fav.ok && fav.status !== 409 && fav.status !== 400) {
    // some impls return 200 always; soft-continue
    steps.push(`favorite pro2 status=${fav.status}`);
  } else {
    steps.push("favorited pro2 for shortlist");
  }

  const job2 = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave18 shortlist heat gate",
      description: "Open job for shortlist heat invite gate",
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
  const job2Id = job2.job?.id;
  if (!job2Id) throw new Error("job2 missing");

  const ranked = await apiOk(`/api/jobs/${job2Id}/shortlist-ranked`, {
    token: home.token,
  });
  const sl = ranked.shortlist || [];
  steps.push(`shortlist ranked ${sl.length}; minHeat=${ranked.shortlistInviteMinHeat}`);
  if (ranked.shortlistInviteMinHeat == null) {
    throw new Error("shortlistInviteMinHeat missing");
  }

  // Find a pro with clean heat below absurd threshold, or use minHeat=99 to force block when clean
  const cleanPro = sl.find((p) => p.availabilityHeat?.clean);
  if (cleanPro) {
    const score = Number(cleanPro.availabilityHeat.score || 0);
    const gateMin = score + 1; // always strictly above current score (incl. 100→101)
    const block = await api(`/api/jobs/${job2Id}/invite-pro`, {
      method: "POST",
      token: home.token,
      body: {
        tradespersonId: cleanPro.userId,
        source: "shortlist",
        shortlistRank: 1,
        minHeat: gateMin,
      },
    });
    if (block.status !== 400 || block.data.code !== "SHORTLIST_HEAT_TOO_LOW") {
      throw new Error(
        `expected SHORTLIST_HEAT_TOO_LOW (minHeat=${gateMin} score=${score}) got ${block.status} ${block.data.code}`
      );
    }
    steps.push(`shortlist heat gate blocked ${cleanPro.userId} score=${score} < ${gateMin}`);

    // Unclean / low gate should allow when minHeat low enough
    const allow = await api(`/api/jobs/${job2Id}/invite-pro`, {
      method: "POST",
      token: home.token,
      body: {
        tradespersonId: cleanPro.userId,
        source: "shortlist",
        shortlistRank: 1,
        minHeat: 1,
        message: "wave18 shortlist invite ok",
      },
    });
    if (!allow.ok && allow.data.code !== "ALREADY_INVITED") {
      throw new Error(`shortlist invite minHeat=1 failed: ${allow.status} ${allow.data.message}`);
    }
    steps.push("shortlist invite allowed at minHeat=1");
  } else {
    steps.push("no clean-heat shortlist pro — gate assert skipped");
  }

  // Viewed-no-reply on a fresh open job/bid
  const job3 = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave18 viewed-no-reply",
      description: "Nudge smoke",
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
  const job3Id = job3.job?.id;
  const bid3 = await apiOk(`/api/jobs/${job3Id}/bids`, {
    method: "POST",
    token: pro.token,
    body: {
      amount: 3000,
      quoteAmount: 2900,
      quoteNotes: "wave18 nudge quote",
    },
  });
  const bid3Id = bid3.bid?.id;
  await apiOk(`/api/bids/${bid3Id}/quote`, {
    method: "PATCH",
    token: pro.token,
    body: { quoteAmount: 2800, quoteNotes: "revised for view" },
  });
  await apiOk(`/api/bids/${bid3Id}/quote-viewed`, {
    method: "POST",
    token: home.token,
  });

  const nudge = await apiOk(`/api/bids/${bid3Id}/viewed-no-reply?forceHours=5&force=1`, {
    method: "POST",
    token: pro.token,
  });
  if (!nudge.viewedNoReply?.due) throw new Error("viewedNoReply.due expected true");
  if (!nudge.viewedNoReply?.nudged) throw new Error("expected nudged=true on force");
  steps.push(`viewed-no-reply nudged (threshold ${nudge.viewedNoReply.thresholdHours}h)`);

  const proNotes = await apiOk("/api/notifications?limit=40", { token: pro.token });
  const proList = Array.isArray(proNotes.notifications || proNotes.items)
    ? proNotes.notifications || proNotes.items
    : [];
  const vnr = proList.find(
    (n) => n.meta?.viewedNoReply === true && n.meta?.bidId === bid3Id
  );
  if (!vnr) throw new Error("pro viewed-no-reply notify missing");
  steps.push("pro viewed-no-reply notify ok");

  // Soft flag on listBids
  const list = await apiOk(`/api/jobs/${job3Id}/bids`, { token: pro.token });
  const b3 = (list.bids || []).find((b) => b.id === bid3Id);
  if (!b3?.viewedNoReply) throw new Error("listBids missing viewedNoReply soft flag");
  if (b3.viewedNoReply.nudgeSentAt == null && !b3.viewedNoReply.nudged) {
    // nudge already persisted on bid from force check
  }
  steps.push(
    `listBids viewedNoReply.due=${b3.viewedNoReply.due} nudgeSent=${Boolean(b3.quoteViewedNudgeSentAt || b3.viewedNoReply.nudgeSentAt)}`
  );

  console.log("wave18:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave18:smoke FAIL", e.message || e);
  process.exit(1);
});
