import type { TemplateKind } from "../entities/UserTemplate";

type Raw = Record<string, unknown>;
const str = (v: unknown, max: number) => (v == null ? "" : String(v).trim().slice(0, max));

function textTemplates(items: Raw[], prefix: string) {
  return items
    .slice(0, 20)
    .map((t, i) => ({
      id: str(t.id, 64) || `${prefix}-${Date.now()}-${i}`,
      label: str(t.label, 80) || "Template",
      body: str(t.body, 500),
      createdAt: str(t.createdAt, 40) || new Date().toISOString(),
    }))
    .filter((t) => t.body.length > 0);
}

function namedJobTemplates(items: Raw[]) {
  const out: Record<string, unknown>[] = [];
  items.slice(0, 24).forEach((t, i) => {
    const name = str(t.name ?? t.label, 80);
    const title = str(t.title, 120);
    if (!name || !title) return;
    const entry: Record<string, unknown> = {
      id: str(t.id, 64) || `njt-${Date.now()}-${i}`,
      name,
      title,
      description: str(t.description, 4000),
      category: str(t.category, 40) || "other",
      createdAt: str(t.createdAt, 40) || new Date().toISOString(),
    };
    if (t.siteType === "office" || t.siteType === "residential") entry.siteType = t.siteType;
    if (t.pinned === true) entry.pinned = true;
    const optional: [string, number][] = [
      ["cadence", 20],
      ["cadenceNote", 500],
      ["budgetMin", 20],
      ["budgetMax", 20],
      ["address", 200],
      ["city", 80],
      ["area", 80],
      ["pincode", 20],
      ["lat", 32],
      ["lng", 32],
      ["sourceJobId", 64],
    ];
    for (const [key, max] of optional) {
      const v = str(t[key], max);
      if (v) entry[key] = v;
    }
    out.push(entry);
  });
  return out;
}

export function normalizeTemplates(kind: TemplateKind, items: Raw[]): Record<string, unknown>[] {
  const list = Array.isArray(items) ? items.filter((x) => x && typeof x === "object") : [];
  switch (kind) {
    case "invite":
      return textTemplates(list, "tpl");
    case "counter":
      return textTemplates(list, "ctr");
    case "homeownerCounter":
      return textTemplates(list, "ho-ctr");
    case "intro":
      return textTemplates(list, "intro");
    case "namedJob":
      return namedJobTemplates(list);
  }
}
