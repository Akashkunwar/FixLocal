/** Wave 26 API/UI smoke: /client+/professional aliases, siteType, lead-group IA copy. */
const API = process.env.API_URL || "http://localhost:3001";
const FE = process.env.FE_URL || "http://localhost:5173";
const PASS = process.env.SEED_PASSWORD || "Password123!";

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
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

async function apiOk(path, opts) {
  const r = await api(path, opts);
  if (!r.ok) {
    throw new Error(
      `${opts?.method || "GET"} ${path} → ${r.status} ${JSON.stringify(r.data)}`
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
  steps.push("login client + professional");

  const job = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave26 smoke — residential plumbing",
      description: "Wave 26 smoke job with residential siteType tag.",
      category: "plumbing",
      siteType: "residential",
      budgetMin: 800,
      budgetMax: 2500,
      address: "Wave26 Test St",
      area: "Indiranagar",
      city: "Bengaluru",
      pincode: "560038",
      maxBids: 4,
    },
  });
  const id = job.job?.id || job.id;
  if (!id) throw new Error(`no job id: ${JSON.stringify(job)}`);
  if ((job.job?.siteType || job.siteType) !== "residential") {
    throw new Error(`siteType not saved: ${JSON.stringify(job.job || job)}`);
  }
  steps.push("posted job with siteType=residential");

  const office = await apiOk("/api/jobs", {
    method: "POST",
    token: home.token,
    body: {
      title: "Wave26 smoke — office facilities",
      description: "Wave 26 smoke job with office siteType.",
      category: "office_facilities",
      siteType: "office",
      budgetMin: 2000,
      budgetMax: 8000,
      address: "Wave26 Office",
      area: "Koramangala",
      city: "Bengaluru",
      pincode: "560034",
      maxBids: 5,
    },
  });
  if ((office.job?.siteType || office.siteType) !== "office") {
    throw new Error("office siteType not saved");
  }
  steps.push("posted job with siteType=office");

  const filtered = await apiOk("/api/jobs?siteType=residential&status=open", {
    token: pro.token,
  });
  const jobs = filtered.jobs || filtered;
  if (!Array.isArray(jobs) || !jobs.some((j) => j.siteType === "residential")) {
    throw new Error("browse filter siteType=residential empty/mismatch");
  }
  steps.push("browse filter by siteType");

  const bad = await api("/api/jobs?siteType=warehouse", { token: pro.token });
  if (bad.ok) throw new Error("invalid siteType should 400");
  steps.push("invalid siteType rejected");

  // FE route alias + IA source smoke (vite serves modules in dev)
  const htmlRes = await fetch(FE + "/");
  if (!htmlRes.ok) throw new Error(`FE ${FE} → ${htmlRes.status}`);
  steps.push("FE index reachable");

  const checks = [
    ["/src/App.tsx", ["CLIENT_ROOT", "PRO_ROOT", "LegacyRedirect"]],
    ["/src/lib/paths.ts", ["CLIENT_ROOT", "PRO_ROOT", "/client", "/professional", "/homeowner", "/tradesperson", "siteType"]],
    ["/src/pages/RegisterPage.tsx", ["I post work", "I bid on work"]],
    ["/src/pages/LandingPage.tsx", ["pros?category=", "Find pros", "Browse jobs"]],
    ["/src/pages/homeowner/CreateJobPage.tsx", ["leadGroup", "Specialty", "Work type"]],
    ["/src/pages/tradesperson/ProfilePage.tsx", ["Skills / specialties"]],
  ];

  for (const [path, needles] of checks) {
    const mod = await fetch(`${FE}${path}`);
    if (!mod.ok) {
      steps.push(`${path} not served (ok if preview build)`);
      continue;
    }
    const src = await mod.text();
    for (const n of needles) {
      if (!src.includes(n)) throw new Error(`${path} missing ${JSON.stringify(n)}`);
    }
    // residual slang soft check on Register + Landing UI modules
    if (path.includes("RegisterPage") || path.includes("LandingPage")) {
      if (/\bHomeowner\b|\bTradesperson\b/.test(src)) {
        throw new Error(`${path} still shows Homeowner/Tradesperson slang`);
      }
    }
    steps.push(`${path} IA smoke`);
  }

  // Shell nav uses canonical aliases
  const shell = await fetch(`${FE}/src/components/Shell.tsx`);
  if (shell.ok) {
    const src = await shell.text();
    if (!src.includes('to: "/client"') || !src.includes('to: "/professional"')) {
      throw new Error("Shell nav missing /client or /professional");
    }
    steps.push("Shell canonical nav");
  }

  console.log("wave26:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave26:smoke FAIL", e);
  process.exit(1);
});
