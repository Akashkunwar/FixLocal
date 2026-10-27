/**
 * Indian GSTIN: 2-digit state code, 10-character PAN, entity number, "Z", check character.
 * The check character uses the GSTN base-36 algorithm, so typos are caught before they reach an invoice.
 */
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SHAPE = /^(0[1-9]|[1-2]\d|3[0-8]|97|99)[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export function normalizeGstin(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function isValidGstin(raw: string): boolean {
  const g = normalizeGstin(raw);
  return SHAPE.test(g) && gstinCheckChar(g.slice(0, 14)) === g[14];
}
