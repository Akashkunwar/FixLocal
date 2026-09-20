import { z } from "zod";

const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

export const id = z.guid({ message: "Must be a valid id" });
export const idParams = z.object({ id });

export const text = (max: number) => z.string().trim().max(max, `Must be at most ${max} characters`);
export const requiredText = (max: number) => text(max).min(1, "Required");
export const optionalText = (max: number) =>
  z.preprocess((v) => (v === null ? undefined : v), text(max).optional());
/** Accepts null or "" to clear a value. */
export const nullableText = (max: number) =>
  z.preprocess((v) => (v === "" ? null : v), text(max).nullable().optional());

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: "Enter a valid email address" }));

export const MONEY_MAX = 10_000_000;
const roundMoney = (n: number) => Math.round(n * 100) / 100;

export const money = z.coerce
  .number({ message: "Must be a number" })
  .finite()
  .gt(0, "Must be greater than 0")
  .max(MONEY_MAX, `Must be at most ${MONEY_MAX}`)
  .transform(roundMoney);

export const optionalMoney = z.preprocess(blankToUndefined, money.optional());
export const optionalNonNegativeMoney = z.preprocess(
  blankToUndefined,
  z.coerce.number().finite().min(0).max(MONEY_MAX).transform(roundMoney).optional()
);

export const optionalInt = (min: number, max: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int("Must be a whole number").min(min).max(max).optional());

export const optionalNumber = (min: number, max: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().finite().min(min).max(max).optional());

export const latitude = optionalNumber(-90, 90);
export const longitude = optionalNumber(-180, 180);

export const isoDate = z.coerce.date({ message: "Must be a valid date" }).refine((d) => !Number.isNaN(d.getTime()), {
  message: "Must be a valid date",
});
export const optionalDate = z.preprocess(blankToUndefined, isoDate.optional());

/** "1"/"true"/true → true; "0"/"false"/false → false (forms send strings). */
export const boolish = z.preprocess((v) => {
  if (v === "1" || v === "true" || v === true) return true;
  if (v === "0" || v === "false" || v === false || v === "" || v === undefined) return false;
  return v;
}, z.boolean());

export const page = optionalInt(1, 10_000);
export const limit = (max: number) => optionalInt(1, max);

export function enumOf<T extends Record<string, string>>(e: T, message?: string) {
  return z.enum(Object.values(e) as [string, ...string[]], message ? { message } : undefined);
}

/** A JSON array sent either as JSON or as a JSON string inside a multipart form. */
export function jsonArray<T extends z.ZodType>(item: T, max: number) {
  return z.preprocess((v) => {
    if (typeof v === "string") {
      if (!v.trim()) return [];
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    }
    return v ?? [];
  }, z.array(item).max(max));
}

/** Server-issued file reference (the signed query string is ignored). */
export const fileRefString = z
  .string()
  .trim()
  .max(600)
  .regex(/^\/api\/files\/[A-Za-z0-9][A-Za-z0-9._-]{0,254}(\?.*)?$/, "Only files uploaded to FixLocal can be referenced")
  .transform((v) => v.split("?")[0]);
