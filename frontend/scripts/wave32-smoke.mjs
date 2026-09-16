/** Wave 32 API/UI smoke: client AMC request, portfolio→bid fill IA, named-template filter, multi-ICS. */
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

  // Ensure pro has a Wave32 rate package for bid-fill IA
  const profile = await apiOk("/api/profile", { token: pro.token });
  const pkgs = Array.isArray(profile.profile?.customRatePackages)
    ? [...profile.profile.customRatePackages]
    : [];
  if (!pkgs.some((p) => String(p.label || "").includes("Wave32"))) {
    pkgs.unshift({
      id: `pkg-w32-${Date.now().toString(36)}`,
      label: "Wave32 bid fill pack",
      hint: "Smoke package for bid quote fill",
      amountMin: 2200,
      amountMax: 3200,
      unit: "visit",
    });
    await apiOk("/api/profile", {
      method: "PATCH",
      token: pro.token,
      body: { customRatePackages: pkgs.slice(0, 12) },
    });
    steps.push("ensured Wave32 custom rate package on portfolio");
  } else {
    steps.push("portfolio already has Wave32 rate package");
  }

  // Named templates with multiple specialties for filter smoke
  const named = [
    {
      id: `njt-w32-plumb-${Date.now().toString(36)}`,
      name: "Wave32 plumbing template",
      title: "Kitchen leak follow-up",
      description: "Named library specialty filter smoke",
      category: "plumbing",
      siteType: "residential",
      cadence: "one_time",
      city: "Bengaluru",
      createdAt: new Date().toISOString(),
    },
    {
      id: `njt-w32-elec-${Date.now().toString(36)}`,
      name: "Wave32 electrical template",
      title: "DB checkup",
      description: "Second specialty for filter chips",
      category: "electrical",
      siteType: "residential",
      cadence: "monthly",
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
  if (saved.length < 2) throw new Error("expected >=2 namedJobTemplates for filter smoke");
  steps.push("PATCH namedJobTemplates (multi-specialty) on client");

  // Find awarded job for AMC request flow
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
  if (!job?.id) throw new Error("No awarded job for AMC request smoke");
  steps.push(`using job ${job.id} (${job.status})`);

  // Clear any open proposal by declining if proposed, or accepting path via fresh request
  // If open proposed/requested, try to clear: client can only request when not open
  let fresh = await apiOk(`/api/jobs/${job.id}`, { token: home.token });
  const cur = fresh.job?.amcProposal;
  if (cur?.status === "proposed") {
    await apiOk(`/api/jobs/${job.id}/amc-proposal/reply`, {
      method: "POST",
      token: home.token,
      body: { action: "decline", replyNote: "Wave32 clear for request smoke" },
    });
    steps.push("declined open pro proposal to clear path");
  } else if (cur?.status === "requested") {
    await apiOk(`/api/jobs/${job.id}/amc-request/reply`, {
      method: "POST",
      token: pro.token,
      body: { action: "decline", replyNote: "Wave32 clear for request smoke" },
    });
    steps.push("declined open client request to clear path");
  }

  // Client request AMC
  const requested = await apiOk(`/api/jobs/${job.id}/amc-request`, {
    method: "POST",
    token: home.token,
    body: {
      cadence: "monthly",
      packageLabel: "Wave32 client AMC request",
      amountMin: 1800,
      amountMax: 2800,
      unit: "visit",
      note: "Client-initiated request smoke",
    },
  });
  if (requested.job?.amcProposal?.status !== "requested") {
    throw new Error("expected amcProposal.status requested");
  }
  steps.push("client POST amc-request → status requested");

  // Pro should not propose while request is open
  const blocked = await api(`/api/jobs/${job.id}/amc-proposal`, {
    method: "POST",
    token: pro.token,
    body: {
      cadence: "monthly",
      packageLabel: "should fail",
      amountMin: 1,
    },
  });
  if (blocked.ok) throw new Error("pro propose should fail while client request open");
  steps.push("pro propose blocked while client request open");

  // Pro accepts request
  const accepted = await apiOk(`/api/jobs/${job.id}/amc-request/reply`, {
    method: "POST",
    token: pro.token,
    body: {
      action: "accept",
      replyNote: "Wave32 pro accept",
      amountMin: 2000,
      amountMax: 3000,
      packageLabel: "Wave32 client AMC request",
      cadence: "monthly",
    },
  });
  if (accepted.job?.amcProposal?.status !== "accepted") {
    throw new Error("expected accepted after pro reply");
  }
  steps.push("pro amc-request/reply accept");

  // Source IA smoke
  const checks = [
    [
      "src/components/AmcProposalCard.tsx",
      [
        "Request AMC",
        "requestAmc",
        "replyAmcRequest",
        "showClientRequest",
        "showProReplyToRequest",
        "downloadAmcMultiEventIcs",
        "hasAmcMultiEventStub",
      ],
    ],
    [
      "src/lib/ics.ts",
      [
        "buildAmcMultiEventIcs",
        "downloadAmcMultiEventIcs",
        "hasAmcMultiEventStub",
        "AMC Multi Event Stub",
        "BEGIN:VEVENT",
      ],
    ],
    [
      "src/lib/namedJobTemplates.ts",
      [
        "filterNamedJobTemplates",
        "namedTemplateSpecialtyOptions",
      ],
    ],
    [
      "src/pages/homeowner/CreateJobPage.tsx",
      [
        "filterNamedJobTemplates",
        "namedSpecialty",
        "Search named job templates",
        "Filter templates by specialty",
        "filteredNamedLibrary",
      ],
    ],
    [
      "src/pages/tradesperson/ProJobDetailPage.tsx",
      [
        "bidFillPackages",
        "applyPortfolioPackageToBid",
        "Fill from portfolio packages",
        "softRatePackages",
      ],
    ],
    [
      "src/components/CompletionPhotosPanel.tsx",
      [
        "fixlocal_case_study_draft_",
        "Draft autosaves in this browser",
      ],
    ],
    [
      "src/api/jobs.ts",
      ["requestAmc", "replyAmcRequest", '"requested"'],
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
    ["src/controllers/amcProposalController.ts", ["requestAmc", "replyAmcRequest", "CLIENT_REQUEST_OPEN"]],
    ["src/routes/jobs.ts", ["amc-request", "replyAmcRequest"]],
    ["src/entities/Job.ts", ['"requested"']],
  ];
  for (const [rel, needles] of beChecks) {
    const src = fs.readFileSync(path.join(beRoot, rel), "utf8");
    for (const n of needles) {
      if (!src.includes(n)) throw new Error(`backend ${rel} missing ${JSON.stringify(n)}`);
    }
    steps.push(`backend/${rel} smoke`);
  }

  // Multi-event ICS source shape: at least two BEGIN:VEVENT in builder
  const icsSrc = read("src/lib/ics.ts");
  const builder = icsSrc.slice(icsSrc.indexOf("buildAmcMultiEventIcs"));
  const veventCount = (builder.match(/BEGIN:VEVENT/g) || []).length;
  if (veventCount < 2) throw new Error("multi-event ICS builder should emit 2+ VEVENT stubs");
  steps.push("multi-event ICS has 2+ VEVENT stubs");

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

  console.log("wave32:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave32:smoke FAIL", e);
  process.exit(1);
});
