/** Small, pure statistics helpers shared by analytics endpoints. */

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return round1(values.reduce((a, b) => a + b, 0) / values.length);
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return round1(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

/** Percentage 0–100 with one decimal; never above 100 and 0 when the denominator is 0. */
export function rate(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.min(100, round1((part / whole) * 100));
}
