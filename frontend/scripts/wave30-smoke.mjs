/** Wave 30 API/UI smoke: repeat-job IA, publish case study, soft AMC proposal. */
const API = process.env.API_URL || "http://localhost:3001";
const FE = process.env.FE_URL || "http://localhost:5173";
const PASS = process.env.SEED_PASSWORD || "Password123!";
const fs = await import("fs");
const path = await import("path");
const { fileURLToPath } = await import("url");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function api(p, { method = "GET", token, body } = {}) {
  const res = await fetch(`${API}${p}`, {
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

async function apiOk(p, opts) {
  const r = await api(p, opts);
  if (!r.ok) {
    throw new Error(
      `${opts?.method || "GET"} ${p} → ${r.status} ${JSON.stringify(r.data)}`
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

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

async function main() {
  const steps = [];

  const home = await login("home@fixlocal.local");
  const pro = await login("pro@fixlocal.local");
  steps.push("login client + professional");

  // Find or create an awarded/in-progress/completed job for this pro
  const listed = await apiOk("/api/jobs?status=awarded", { token: home.token });
  let job =
    (listed.jobs || []).find((j) => j.acceptedBidId) ||
    (await apiOk("/api/jobs?status=in_progress", { token: home.token })).jobs?.[0] ||
    (await apiOk("/api/jobs?status=completed", { token: home.token })).jobs?.[0];

  if (!job) {
    // Create + award path may be heavy; try any job where pro has accepted bid via listBids scan
    const all = await apiOk("/api/jobs", { token: home.token });
    for (const j of all.jobs || []) {
      if (!["awarded", "in_progress", "completed", "disputed"].includes(j.status)) continue;
      const bids = await api(`/api/jobs/${j.id}/bids`, { token: home.token });
      const accepted = (bids.data?.bids || []).find((b) => b.status === "accepted");
      if (accepted && accepted.tradespersonId === pro.user.id) {
        job = j;
        break;
      }
    }
  }

  if (!job?.id) {
    throw new Error("No awarded/in-progress/completed job for smoke — seed data needed");
  }
  steps.push(`using job ${job.id} (${job.status})`);

  // Soft AMC propose (pro)
  const proposed = await apiOk(`/api/jobs/${job.id}/amc-proposal`, {
    method: "POST",
    token: pro.token,
    body: {
      cadence: "amc",
      packageLabel: "Wave30 annual care",
      amountMin: 4999,
      amountMax: 7999,
      unit: "year",
      note: "Soft AMC smoke — quarterly visits included",
    },
  });
  if (proposed.job?.amcProposal?.status !== "proposed") {
    throw new Error("amcProposal not proposed");
  }
  if (proposed.job.amcProposal.packageLabel !== "Wave30 annual care") {
    throw new Error("packageLabel mismatch");
  }
  steps.push("POST amc-proposal");

  // Client counter reply
  const countered = await apiOk(`/api/jobs/${job.id}/amc-proposal/reply`, {
    method: "POST",
    token: home.token,
    body: {
      action: "counter",
      replyNote: "Prefer monthly for now",
      replyCadence: "monthly",
    },
  });
  if (countered.job?.amcProposal?.status !== "countered") {
    throw new Error("expected countered status");
  }
  steps.push("POST amc-proposal/reply counter");

  // Re-propose then accept
  await apiOk(`/api/jobs/${job.id}/amc-proposal`, {
    method: "POST",
    token: pro.token,
    body: {
      cadence: "monthly",
      packageLabel: "Wave30 monthly care",
      amountMin: 999,
      unit: "month",
    },
  });
  const accepted = await apiOk(`/api/jobs/${job.id}/amc-proposal/reply`, {
    method: "POST",
    token: home.token,
    body: { action: "accept", replyNote: "Sounds good — chat details" },
  });
  if (accepted.job?.amcProposal?.status !== "accepted") {
    throw new Error("expected accepted status");
  }
  steps.push("AMC accept flow");

  // Ensure completion photos exist (may already) — soft inject via profile path if none
  let fresh = await apiOk(`/api/jobs/${job.id}`, { token: pro.token });
  let before = fresh.job?.beforePhotoUrls || [];
  let after = fresh.job?.afterPhotoUrls || [];

  if (!before.length && !after.length) {
    // Use gallery-less synthetic: PATCH job photos not available — mark publish should 400
    const noPhoto = await api(`/api/jobs/${job.id}/publish-case-study`, {
      method: "POST",
      token: pro.token,
      body: { title: "Should fail" },
    });
    if (noPhoto.status !== 400) {
      throw new Error(`expected NO_PHOTOS 400, got ${noPhoto.status}`);
    }
    steps.push("publish-case-study rejects without photos");

    // Soft: attach via SQL-less approach — upload tiny PNG if multer accepts
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const fd = new FormData();
    fd.append("before", new Blob([png], { type: "image/png" }), "before.png");
    fd.append("after", new Blob([png], { type: "image/png" }), "after.png");
    const up = await fetch(`${API}/api/jobs/${job.id}/completion-photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pro.token}` },
      body: fd,
    });
    const upText = await up.text();
    if (!up.ok) {
      throw new Error(`completion upload failed ${up.status} ${upText}`);
    }
    fresh = JSON.parse(upText);
    before = fresh.job?.beforePhotoUrls || [];
    after = fresh.job?.afterPhotoUrls || [];
    steps.push("uploaded tiny before/after for publish");
  } else {
    steps.push("job already has completion photos");
  }

  const published = await apiOk(`/api/jobs/${job.id}/publish-case-study`, {
    method: "POST",
    token: pro.token,
    body: {
      title: `Wave30 case ${Date.now()}`,
      notes: "Published from completion gallery smoke",
      beforeUrl: before[0],
      afterUrl: after[0],
    },
  });
  if (!published.caseStudy?.id || !published.caseStudy?.title?.includes("Wave30")) {
    throw new Error("case study not returned");
  }
  if (published.caseStudy.sourceJobId !== job.id) {
    throw new Error("sourceJobId not set");
  }
  steps.push("POST publish-case-study");

  const me = await apiOk("/api/profile", { token: pro.token });
  const cases = me.profile?.caseStudies || [];
  if (!cases.some((c) => c.id === published.caseStudy.id)) {
    throw new Error("case study missing on profile");
  }
  steps.push("profile contains published case study");

  // Source IA smoke
  const checks = [
    [
      "src/lib/repeatJob.ts",
      ["saveRepeatDraft", "buildRepeatDraft", "JOB_DRAFT_KEY", "peekRepeatBanner", "(repeat)"],
    ],
    [
      "src/components/AmcProposalCard.tsx",
      ["Soft AMC / recurring", "proposeAmc", "replyAmc", "aria-pressed"],
    ],
    [
      "src/components/CompletionPhotosPanel.tsx",
      ["Publish to portfolio", "publishCaseStudyFromJob", "canPublishCaseStudy"],
    ],
    [
      "src/pages/homeowner/CreateJobPage.tsx",
      ["Prefilling from completed job", "peekRepeatBanner", "JOB_DRAFT_KEY"],
    ],
    [
      "src/pages/homeowner/JobDetailPage.tsx",
      ["Repeat this job", "AmcProposalCard", "saveRepeatDraft"],
    ],
    [
      "src/pages/homeowner/HomeownerDashboard.tsx",
      ["Repeat this job", "saveRepeatDraft"],
    ],
    [
      "src/pages/tradesperson/ProJobDetailPage.tsx",
      ["AmcProposalCard", "canPublishCaseStudy"],
    ],
    [
      "src/api/jobs.ts",
      ["publishCaseStudyFromJob", "proposeAmc", "replyAmc", "AmcProposal"],
    ],
  ];

  for (const [rel, needles] of checks) {
    const src = read(rel);
    for (const n of needles) {
      if (!src.includes(n)) throw new Error(`${rel} missing ${JSON.stringify(n)}`);
    }
    steps.push(`${rel} IA smoke`);
  }

  // Backend source smoke (relative to frontend root → ../backend)
  const beRoot = path.join(root, "..", "backend");
  const beChecks = [
    [
      "src/controllers/amcProposalController.ts",
      ["proposeAmc", "replyAmc", "packageLabel"],
    ],
    [
      "src/controllers/publishCaseStudyController.ts",
      ["publishCaseStudyFromJob", "sourceJobId", "NO_PHOTOS"],
    ],
    [
      "src/entities/Job.ts",
      ["amcProposal", "packageLabel"],
    ],
  ];
  for (const [rel, needles] of beChecks) {
    const src = fs.readFileSync(path.join(beRoot, rel), "utf8");
    for (const n of needles) {
      if (!src.includes(n)) throw new Error(`backend ${rel} missing ${JSON.stringify(n)}`);
    }
    steps.push(`backend/${rel} smoke`);
  }

  const feHosts = [FE, "http://127.0.0.1:5173", "http://localhost:5173", "http://[::1]:5173"];
  let feOk = false;
  let feTried = [];
  for (const base of [...new Set(feHosts)]) {
    try {
      const htmlRes = await fetch(base + "/");
      feTried.push(`${base}→${htmlRes.status}`);
      if (htmlRes.ok) {
        feOk = true;
        steps.push(`FE index reachable (${base})`);
        break;
      }
    } catch (e) {
      feTried.push(`${base}→${e.cause?.code || e.message}`);
    }
  }
  if (!feOk) throw new Error(`FE unreachable: ${feTried.join("; ")}`);

  console.log("wave30:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave30:smoke FAIL", e);
  process.exit(1);
});
