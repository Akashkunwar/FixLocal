/** Wave 31 API/UI smoke: AMC rate-package fill IA, named job templates, AMC ICS hint, pair picker. */
const API = process.env.API_URL || "http://127.0.0.1:3001";
const FE = process.env.FE_URL || "http://127.0.0.1:5173";
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

  // Ensure pro has at least one custom rate package for fill IA (optional soft ok)
  const profile = await apiOk("/api/profile", { token: pro.token });
  const pkgs = Array.isArray(profile.profile?.customRatePackages)
    ? [...profile.profile.customRatePackages]
    : [];
  if (!pkgs.some((p) => String(p.label || "").includes("Wave31"))) {
    pkgs.unshift({
      id: `pkg-w31-${Date.now().toString(36)}`,
      label: "Wave31 AMC fill pack",
      hint: "Smoke package for one-click AMC fill",
      amountMin: 1500,
      amountMax: 2500,
      unit: "visit",
    });
    await apiOk("/api/profile", {
      method: "PATCH",
      token: pro.token,
      body: { customRatePackages: pkgs.slice(0, 12) },
    });
    steps.push("ensured Wave31 custom rate package on portfolio");
  } else {
    steps.push("portfolio already has Wave31 rate package");
  }

  // Named job templates on client User
  const named = [
    {
      id: `njt-w31-${Date.now().toString(36)}`,
      name: "Wave31 kitchen leak template",
      title: "Kitchen leak follow-up",
      description: "Named library smoke from completed-job pattern",
      category: "plumbing",
      siteType: "residential",
      cadence: "one_time",
      city: "Bengaluru",
      createdAt: new Date().toISOString(),
    },
  ];
  const patched = await apiOk("/api/auth/me", {
    method: "PATCH",
    token: home.token,
    body: { namedJobTemplates: named },
  });
  const saved = patched.user?.namedJobTemplates || [];
  if (!saved.some((t) => t.name === "Wave31 kitchen leak template")) {
    throw new Error("namedJobTemplates not persisted on /api/auth/me");
  }
  steps.push("PATCH namedJobTemplates on client");

  const me = await apiOk("/api/auth/me", { token: home.token });
  if (!(me.user?.namedJobTemplates || []).some((t) => t.id === named[0].id)) {
    throw new Error("namedJobTemplates missing on GET /api/auth/me");
  }
  steps.push("GET /api/auth/me returns namedJobTemplates");

  // Find awarded/in-progress/completed job for AMC accept + ICS IA
  const listed = await apiOk("/api/jobs?status=awarded", { token: home.token });
  let job =
    (listed.jobs || []).find((j) => j.acceptedBidId) ||
    (await apiOk("/api/jobs?status=in_progress", { token: home.token })).jobs?.[0] ||
    (await apiOk("/api/jobs?status=completed", { token: home.token })).jobs?.[0];

  if (!job?.id) {
    const all = await apiOk("/api/jobs", { token: home.token });
    for (const j of all.jobs || []) {
      if (!["awarded", "in_progress", "completed", "disputed"].includes(j.status)) continue;
      if (j.acceptedBidId) {
        job = j;
        break;
      }
    }
  }
  if (!job?.id) throw new Error("No awarded job for AMC smoke");
  steps.push(`using job ${job.id} (${job.status})`);

  // Propose from package-like body then accept → status accepted for calendar hint
  await apiOk(`/api/jobs/${job.id}/amc-proposal`, {
    method: "POST",
    token: pro.token,
    body: {
      cadence: "monthly",
      packageLabel: "Wave31 AMC fill pack",
      amountMin: 1500,
      amountMax: 2500,
      unit: "visit",
      note: "Filled from portfolio package smoke",
    },
  });
  const accepted = await apiOk(`/api/jobs/${job.id}/amc-proposal/reply`, {
    method: "POST",
    token: home.token,
    body: { action: "accept", replyNote: "Wave31 accept for calendar hint" },
  });
  if (accepted.job?.amcProposal?.status !== "accepted") {
    throw new Error("expected accepted AMC for calendar hint");
  }
  steps.push("AMC propose + accept for next-visit hint");

  // Completion photos + pair pick publish
  let fresh = await apiOk(`/api/jobs/${job.id}`, { token: pro.token });
  let before = fresh.job?.beforePhotoUrls || [];
  let after = fresh.job?.afterPhotoUrls || [];
  if (before.length < 2 || after.length < 1) {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const fd = new FormData();
    fd.append("before", new Blob([png], { type: "image/png" }), "b1.png");
    fd.append("before", new Blob([png], { type: "image/png" }), "b2.png");
    fd.append("after", new Blob([png], { type: "image/png" }), "a1.png");
    const up = await fetch(`${API}/api/jobs/${job.id}/completion-photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pro.token}` },
      body: fd,
    });
    const upText = await up.text();
    if (!up.ok) throw new Error(`completion upload failed ${up.status} ${upText}`);
    fresh = JSON.parse(upText);
    before = fresh.job?.beforePhotoUrls || [];
    after = fresh.job?.afterPhotoUrls || [];
    steps.push("uploaded multi before/after for pair picker");
  } else {
    steps.push("job already has multi completion photos");
  }

  // Publishing job photos needs the client's consent (M-7).
  await apiOk(`/api/jobs/${job.id}/photo-consent`, {
    method: "POST",
    token: home.token,
    body: { consent: true },
  });
  steps.push("client allowed photo publishing");

  const pickBefore = before[before.length - 1] || before[0];
  const pickAfter = after[0];
  const published = await apiOk(`/api/jobs/${job.id}/publish-case-study`, {
    method: "POST",
    token: pro.token,
    body: {
      title: `Wave31 pair ${Date.now()}`,
      notes: "Pair picker smoke",
      beforeUrl: pickBefore,
      afterUrl: pickAfter,
    },
  });
  // Publishing makes public copies of the picked photos (C-4), so compare the images, not URLs.
  const bytes = async (url) => Buffer.from(await (await fetch(`${API}${url}`)).arrayBuffer());
  if (!(await bytes(published.caseStudy?.beforeUrl)).equals(await bytes(pickBefore))) {
    throw new Error("pair picker beforeUrl not honored");
  }
  if (pickAfter && !(await bytes(published.caseStudy?.afterUrl)).equals(await bytes(pickAfter))) {
    throw new Error("pair picker afterUrl not honored");
  }
  steps.push("publish-case-study honors picked pair URLs");

  // Source IA smoke
  const checks = [
    [
      "src/components/AmcProposalCard.tsx",
      [
        "Fill from portfolio rate packages",
        "applyPackage",
        "Soft next-visit reminder",
        "downloadAmcReminderIcs",
        "customRatePackages",
      ],
    ],
    [
      "src/components/CompletionPhotosPanel.tsx",
      ["pickBefore", "pickAfter", "PairPicker", "aria-selected", "Pick which pair"],
    ],
    [
      "src/lib/namedJobTemplates.ts",
      [
        "namedTemplateFromJob",
        "draftFromNamedTemplate",
        "mergeNamedJobTemplates",
        "upsertNamedJobTemplate",
      ],
    ],
    [
      "src/lib/ics.ts",
      ["buildAmcReminderIcs", "downloadAmcReminderIcs", "googleAmcReminderUrl", "STATUS:TENTATIVE"],
    ],
    [
      "src/lib/jobCadence.ts",
      ["suggestNextVisitIso", "cadenceNextVisitDays"],
    ],
    [
      "src/pages/homeowner/CreateJobPage.tsx",
      ["Your job templates", "applyNamedTemplate", "namedLibrary"],
    ],
    [
      "src/pages/homeowner/JobDetailPage.tsx",
      ["Save as template", "namedTemplateFromJob", "namedJobTemplates"],
    ],
    [
      "src/pages/homeowner/HomeownerDashboard.tsx",
      ["Save as template", "namedTemplateFromJob"],
    ],
    [
      "src/pages/tradesperson/ProJobDetailPage.tsx",
      ["customRatePackages", "amcCustomPackages", "hourlyRateMin"],
    ],
    [
      "src/pages/SettingsPage.tsx",
      // Templates save straight to the account now (no separate "sync" step).
      ["Named job templates", "namedJobTemplates", "deleteNamedJobTemplate"],
    ],
  ];

  for (const [rel, needles] of checks) {
    const src = read(rel);
    for (const n of needles) {
      if (!src.includes(n)) throw new Error(`${rel} missing ${JSON.stringify(n)}`);
    }
    steps.push(`${rel} IA smoke`);
  }

  const beRoot = path.join(root, "..", "backend");
  const beChecks = [
    // Templates moved from JSON columns on User to the user_templates table (L-7).
    ["src/entities/UserTemplate.ts", ["namedJob"]],
    ["src/validation/templates.ts", ["namedJobTemplates", "sourceJobId"]],
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

  console.log("wave31:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave31:smoke FAIL", e);
  process.exit(1);
});
