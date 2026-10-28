/** Rupee amounts are stored as decimal(12,2): round every computed amount to paise the same way. */
export const roundRupees = (n: number): number => Math.round(n * 100) / 100;
