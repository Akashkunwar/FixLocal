import { money } from "./format";

/** Soft package cards derived from hourly rates — estimates only, not binding quotes. */
export type SoftRateCard = {
  id: string;
  label: string;
  hint: string;
  hours: number;
  amountMin: number;
  amountMax: number;
  display: string;
};

/** Editable custom packages the pro sets explicitly (beyond soft hourly estimates). */
export type CustomRatePackage = {
  id: string;
  label: string;
  hint?: string;
  amountMin: number;
  amountMax?: number | null;
  unit?: string | null;
};

export function softRatePackages(
  hourlyMin?: string | number | null,
  hourlyMax?: string | number | null
): SoftRateCard[] {
  const lo = Number(hourlyMin);
  const hi = Number(hourlyMax ?? hourlyMin);
  if (!Number.isFinite(lo) || lo <= 0) return [];
  const hiSafe = Number.isFinite(hi) && hi >= lo ? hi : lo;

  const packs: { id: string; label: string; hint: string; hours: number }[] = [
    { id: "visit", label: "Site visit", hint: "~1 hour diagnostic / quote visit", hours: 1 },
    { id: "half", label: "Half-day", hint: "~4 hours on site", hours: 4 },
    { id: "day", label: "Full day", hint: "~8 hours on site", hours: 8 },
  ];

  return packs.map((p) => {
    const amountMin = Math.round(lo * p.hours);
    const amountMax = Math.round(hiSafe * p.hours);
    return {
      ...p,
      amountMin,
      amountMax,
      display:
        amountMin === amountMax
          ? money(amountMin)
          : `${money(amountMin)} – ${money(amountMax)}`,
    };
  });
}

export function formatCustomPackage(p: CustomRatePackage): string {
  const lo = Number(p.amountMin);
  const hi = p.amountMax != null ? Number(p.amountMax) : NaN;
  const range =
    Number.isFinite(hi) && hi > lo
      ? `${money(lo)} – ${money(hi)}`
      : money(lo);
  const unit = (p.unit || "").trim();
  return unit ? `${range} / ${unit}` : range;
}

export function normalizeCustomRatePackages(raw: unknown): CustomRatePackage[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomRatePackage[] = [];
  for (let i = 0; i < raw.length && out.length < 12; i++) {
    const t: any = raw[i];
    const label = String(t?.label || "").trim().slice(0, 80);
    const amountMin = Number(t?.amountMin);
    if (!label || !Number.isFinite(amountMin) || amountMin < 0) continue;
    let amountMax: number | null | undefined = undefined;
    if (t?.amountMax != null && t?.amountMax !== "") {
      const n = Number(t.amountMax);
      if (Number.isFinite(n) && n >= amountMin) amountMax = n;
    }
    const hint = t?.hint != null ? String(t.hint).trim().slice(0, 160) : undefined;
    const unit = t?.unit != null ? String(t.unit).trim().slice(0, 40) : undefined;
    out.push({
      id: String(t?.id || `pkg-${i}`).slice(0, 64),
      label,
      ...(hint ? { hint } : {}),
      amountMin: Math.round(amountMin),
      ...(amountMax != null ? { amountMax } : {}),
      ...(unit ? { unit } : {}),
    });
  }
  return out;
}

export function newCustomPackageId() {
  return `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
