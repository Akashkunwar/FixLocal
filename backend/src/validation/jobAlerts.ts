import { z } from "zod";
import { JobCategory } from "../entities/Job";
import { enumOf, latitude, longitude, nullableText, optionalInt, requiredText } from "./common";
import { SITE_TYPES } from "./jobs";

const blankToNull = (v: unknown) => (v === "" ? null : v);
const criteria = {
  categories: z.array(enumOf(JobCategory, "Invalid category")).max(11).optional(),
  city: nullableText(80),
  area: nullableText(120),
  lat: z.preprocess(blankToNull, latitude.nullable()),
  lng: z.preprocess(blankToNull, longitude.nullable()),
  radiusKm: z.preprocess(blankToNull, optionalInt(1, 100).nullable()),
  minBudget: z.preprocess(blankToNull, optionalInt(0, 10_000_000).nullable()),
  siteType: z.preprocess(blankToNull, z.enum(SITE_TYPES).nullable().optional()),
};

const pinNeedsRadius = (v: { lat?: number | null; lng?: number | null; radiusKm?: number | null }) =>
  v.radiusKm == null || (v.lat != null && v.lng != null);
const pinMessage = { message: "A radius needs a map location (lat and lng)", path: ["radiusKm"] };

export const jobAlertBody = z
  .object({ name: requiredText(80), active: z.boolean().default(true), ...criteria })
  .strict()
  .refine(pinNeedsRadius, pinMessage);

export const updateJobAlertBody = z
  .object({
    name: requiredText(80).optional(),
    active: z.boolean().optional(),
    ...criteria,
  })
  .strict();

export const previewJobAlertBody = z.object(criteria).strict().refine(pinNeedsRadius, pinMessage);
