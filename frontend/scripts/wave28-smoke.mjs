/** Wave 28 API/UI smoke: custom rate packages, lead hubs, visit-prep, intro templates. */
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

  // Custom rate packages upsert on profile
  const pkgId = `smoke-pkg-${Date.now()}`;
  const updated = await apiOk("/api/profile", {
    method: "PATCH",
    token: pro.token,
    body: {
      customRatePackages: [
        {
          id: pkgId,
          label: "Leak diagnostic visit",
          hint: "Includes first hour on site",
          amountMin: 499,
          amountMax: 799,
          unit: "visit",
        },
      ],
    },
  });
  const pkgs = updated.profile?.customRatePackages || [];
  if (!pkgs.some((p) => p.id === pkgId && p.label.includes("Leak"))) {
    throw new Error("customRatePackages not persisted on profile");
  }
  steps.push("PATCH customRatePackages");

  const pub = await apiOk(`/api/profile/user/${pro.user.id}`, {
    token: home.token,
  });
  const pubPkgs = pub.profile?.customRatePackages || [];
  if (!pubPkgs.some((p) => p.id === pkgId)) {
    throw new Error("customRatePackages missing on public profile");
  }
  steps.push("public profile exposes customRatePackages");

  // Intro templates sync on User
  const introId = `smoke-intro-${Date.now()}`;
  const me = await apiOk("/api/auth/me", {
    method: "PATCH",
    token: pro.token,
    body: {
      introTemplates: [
        {
          id: introId,
          label: "Smoke hello",
          body: "Hi from wave28 smoke — thanks for awarding the job.",
        },
      ],
    },
  });
  const intros = me.user?.introTemplates || [];
  if (!intros.some((t) => t.id === introId)) {
    throw new Error("introTemplates not on /api/auth/me");
  }
  steps.push("PATCH introTemplates on User");

  // Source IA smoke
  const checks = [
    [
      "src/lib/ratePackages.ts",
      ["CustomRatePackage", "formatCustomPackage", "softRatePackages"],
    ],
    [
      "src/lib/leadGroups.ts",
      ["LEAD_GROUPS", "leadGroupHubPath", "leadGroupFromSlug"],
    ],
    [
      "src/pages/LeadGroupHubPage.tsx",
      ["LeadGroupHubPage", "Find professionals", "Specialties in this group"],
    ],
    [
      "src/pages/LandingPage.tsx",
      ["leadGroupHubPath", "View hub"],
    ],
    [
      "src/components/VisitPrepCard.tsx",
      ["Visit prep", "visitPrepItems", "VisitPrepCard"],
    ],
    [
      "src/lib/visitPrep.ts",
      ["Confirm address & access", "loadVisitPrepChecks", "visitPrepItems"],
    ],
    [
      "src/lib/introTemplates.ts",
      ["DEFAULT_INTRO_STARTERS", "mergeIntroTemplates"],
    ],
    [
      "src/components/JobChat.tsx",
      ["mergeIntroTemplates", "Professional intro message templates"],
    ],
    [
      "src/pages/tradesperson/ProfilePage.tsx",
      ["Custom rate packages", "customRatePackages", "Add package"],
    ],
    [
      "src/pages/ProPublicPage.tsx",
      ["Custom rate packages", "formatCustomPackage"],
    ],
    [
      "src/pages/homeowner/FindProsPage.tsx",
      ["aria-pressed", 'role="group"', "Playbook:"],
    ],
    [
      "src/pages/tradesperson/BrowseJobsPage.tsx",
      ["aria-pressed", "Playbook:"],
    ],
    ["src/App.tsx", ["/categories/:groupSlug", "LeadGroupHubPage"]],
  ];

  for (const [rel, needles] of checks) {
    const src = read(rel);
    for (const n of needles) {
      if (!src.includes(n)) throw new Error(`${rel} missing ${JSON.stringify(n)}`);
    }
    steps.push(`${rel} IA smoke`);
  }

  const htmlRes = await fetch(FE + "/");
  if (!htmlRes.ok) throw new Error(`FE ${FE} → ${htmlRes.status}`);
  steps.push("FE index reachable");

  const hubRes = await fetch(`${FE}/categories/cleaning`);
  if (!hubRes.ok) throw new Error(`FE hub cleaning → ${hubRes.status}`);
  steps.push("FE lead-group hub /categories/cleaning reachable");

  const mod = await fetch(`${FE}/src/lib/leadGroups.ts`);
  if (mod.ok) {
    const src = await mod.text();
    if (!src.includes("leadGroupHubPath")) {
      throw new Error("leadGroups module missing export");
    }
    steps.push("FE leadGroups module");
  } else {
    steps.push("FE leadGroups not served (ok if preview build)");
  }

  console.log("wave28:smoke OK");
  for (const s of steps) console.log(" -", s);
}

main().catch((e) => {
  console.error("wave28:smoke FAIL", e);
  process.exit(1);
});
