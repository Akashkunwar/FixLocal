/**
 * Wave 8 API smoke: richer match scores, map coords on create, quote→escrow, suggested pros.
 * Requires backend :3001 and seeded users.
 */
const API = process.env.API_URL || "http://localhost:3001";
const PASS = process.env.SEED_PASSWORD || "Password123!";

async function api(pathname, { method = "GET", token, body, formData } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (formData) {
    payload = formData;
  } else if (body) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${pathname}`, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status} ${data.message || ""}`);
  return data;
}

async function login(email) {
  return api("/api/auth/login", { method: "POST", body: { email, password: PASS } });
}

async function main() {
  const steps = [];
  const home = await login("home@fixlocal.local");
  const pro = await login("pro@fixlocal.local");
  const admin = await login("admin@fixlocal.local");

  // Richer match-quality
  const mq = await api("/api/admin/match-quality", { token: admin.token });
  if (!mq.summary || !Array.isArray(mq.jobs)) throw new Error("match-quality shape bad");
  if (typeof mq.summary.avgBestScore !== "number") {
    throw new Error("expected avgBestScore on match-quality summary");
  }
  const withTop = mq.jobs.find((j) => Array.isArray(j.topPros) && j.topPros.length);
  if (!withTop) throw new Error("expected topPros on at least one open job");
  if (typeof withTop.bestMatchScore !== "number") throw new Error("bestMatchScore missing");
  if (!withTop.topPros[0].breakdown || typeof withTop.topPros[0].breakdown.skills !== "number") {
    throw new Error("score breakdown missing");
  }
  steps.push(
    `match scores avgBest=${mq.summary.avgBestScore} top=${withTop.topPros[0].score}`
  );

  // Create job with lat/lng (map pin)
  const pinLat = 12.9784;
  const pinLng = 77.6408;
  const created = await api("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave8 map pin smoke",
      description: "Testing Leaflet coords storage for wave 8 smoke test job.",
      category: "plumbing",
      city: "Bengaluru",
      area: "Indiranagar",
      budgetMin: 1000,
      budgetMax: 3000,
      maxBids: 5,
      lat: pinLat,
      lng: pinLng,
    },
  });
  if (!created.job?.id) throw new Error("job create failed");
  if (Math.abs(Number(created.job.lat) - pinLat) > 0.001) {
    throw new Error(`job lat not stored: ${created.job.lat}`);
  }
  if (Math.abs(Number(created.job.lng) - pinLng) > 0.001) {
    throw new Error(`job lng not stored: ${created.job.lng}`);
  }
  steps.push(`job create stored coords ${created.job.lat},${created.job.lng}`);

  // Suggested pros for homeowner
  const sug = await api(`/api/jobs/${created.job.id}/suggested-pros?limit=5`, {
    token: home.token,
  });
  if (!Array.isArray(sug.suggestions) || !sug.suggestions.length) {
    throw new Error("suggested-pros empty");
  }
  if (typeof sug.suggestions[0].score !== "number") throw new Error("suggestion score missing");
  steps.push(`suggested pros n=${sug.suggestions.length} best=${sug.suggestions[0].score}`);

  // Place bid with quoteAmount different from amount
  const bidAmt = 2500;
  const quoteAmt = 2300;
  const placed = await api(`/api/jobs/${created.job.id}/bids`, {
    method: "POST",
    token: pro.token,
    body: {
      amount: bidAmt,
      message: "wave8 quote escrow",
      etaDays: 2,
      quoteAmount: quoteAmt,
      quoteNotes: "Labour + parts breakdown",
    },
  });
  if (!placed.bid?.id) throw new Error("bid place failed");
  steps.push(`bid placed amount=${bidAmt} quote=${quoteAmt}`);

  // Accept → escrow prefers quote
  const accepted = await api(`/api/bids/${placed.bid.id}/accept`, {
    method: "POST",
    token: home.token,
  });
  if (accepted.escrow?.source !== "quote") {
    throw new Error(`expected escrow.source=quote got ${accepted.escrow?.source}`);
  }
  if (Math.abs(Number(accepted.escrow.amount) - quoteAmt) > 0.01) {
    throw new Error(`escrow amount ${accepted.escrow.amount} != quote ${quoteAmt}`);
  }
  if (Math.abs(Number(accepted.job?.escrowAmount) - quoteAmt) > 0.01) {
    throw new Error(`job.escrowAmount ${accepted.job?.escrowAmount} != quote`);
  }
  const pays = await api(`/api/jobs/${created.job.id}/payments`, { token: home.token });
  if (Math.abs(Number(pays.escrowAmount) - quoteAmt) > 0.01) {
    throw new Error(`payments escrowAmount ${pays.escrowAmount} != quote`);
  }
  steps.push(`accept quote→escrow ₹${accepted.escrow.amount} (source=${accepted.escrow.source})`);

  console.log(steps.map((s) => `PASS: ${s}`).join("\n"));
  console.log("\nWAVE8 API SMOKE PASSED");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
