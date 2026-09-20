/** Earth radius in km (mean). */
const R_KM = 6371;

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in kilometres (Haversine). Returns null if any coord missing/invalid. */
export function haversineKm(
  lat1?: number | null,
  lng1?: number | null,
  lat2?: number | null,
  lng2?: number | null
): number | null {
  // Number(null) is 0, so missing coordinates must be rejected before converting.
  if ([lat1, lng1, lat2, lng2].some((v) => v === null || v === undefined || (v as unknown) === "")) return null;
  const a = Number(lat1);
  const b = Number(lng1);
  const c = Number(lat2);
  const d = Number(lng2);
  if (![a, b, c, d].every((n) => Number.isFinite(n))) return null;
  if (Math.abs(a) > 90 || Math.abs(c) > 90) return null;
  if (Math.abs(b) > 180 || Math.abs(d) > 180) return null;

  const dLat = toRad(c - a);
  const dLng = toRad(d - b);
  const lat1r = toRad(a);
  const lat2r = toRad(c);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1r) * Math.cos(lat2r) * Math.sin(dLng / 2) ** 2;
  const km = 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  return Math.round(km * 10) / 10;
}

export function parseCoordPair(
  lat?: unknown,
  lng?: unknown
): { lat: number; lng: number } | null {
  if (lat === null || lat === undefined || lat === "" || lng === null || lng === undefined || lng === "") return null;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lng: b };
}
