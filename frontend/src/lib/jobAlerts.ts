import { t, tf } from "./t";
import type { JobAlertCriteria } from "../api/features";
import { categoryLabel, money } from "./format";

export const RADII = [3, 5, 10, 25];

export type AlertDraft = {
  name: string;
  categories: string[];
  city: string;
  area: string;
  radiusKm: string;
  minBudget: string;
  siteType: "" | "residential" | "office";
};

export function criteriaOf(d: AlertDraft, pin: { lat: number; lng: number } | null): JobAlertCriteria {
  const radius = d.radiusKm && pin ? Number(d.radiusKm) : null;
  return {
    categories: d.categories,
    city: d.city.trim() || null,
    area: d.area.trim() || null,
    lat: radius ? pin!.lat : null,
    lng: radius ? pin!.lng : null,
    radiusKm: radius,
    minBudget: d.minBudget ? Number(d.minBudget) : null,
    siteType: d.siteType || null,
  };
}

/** One line describing an alert, e.g. "Plumbing, Electrical · within 5 km · ₹1,000+". */
export function describeAlert(a: JobAlertCriteria) {
  const bits = [
    a.categories.length ? a.categories.map(categoryLabel).join(", ") : t("Any category"),
    a.radiusKm ? tf("within {km} km of your base", { km: a.radiusKm }) : [a.area, a.city].filter(Boolean).join(", ") || t("anywhere"),
    a.minBudget ? tf("{amount}+ budget", { amount: money(a.minBudget) }) : null,
    a.siteType === "office" ? t("offices") : a.siteType === "residential" ? t("homes") : null,
  ];
  return bits.filter(Boolean).join(" · ");
}

