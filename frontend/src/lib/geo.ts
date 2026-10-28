/** Bengaluru demo centre (default map position). */
export const BLR_CENTER = { lat: 12.9716, lng: 77.5946 };

/**
 * Parse a typed latitude/longitude. Accepts a comma as the decimal mark ("12,97"); returns null for
 * anything that isn't a finite number in range, so a typo can never reach Leaflet as NaN.
 */
export function parseCoord(value: string | number | null | undefined, kind: "lat" | "lng"): number | null {
  if (value === null || value === undefined) return null;
  let s = String(value).trim();
  if (!s) return null;
  if (!s.includes(".") && /^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  const limit = kind === "lat" ? 90 : 180;
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/** Both coordinates valid, or null. */
export function parseLatLng(lat: string | number | null | undefined, lng: string | number | null | undefined) {
  const a = parseCoord(lat, "lat");
  const b = parseCoord(lng, "lng");
  return a === null || b === null ? null : { lat: a, lng: b };
}
