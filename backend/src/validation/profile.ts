import { z } from "zod";
import { JobCategory } from "../entities/Job";
import {
  boolish,
  enumOf,
  fileRefString,
  latitude,
  limit,
  longitude,
  nullableText,
  optionalInt,
  optionalNonNegativeMoney,
  optionalNumber,
  optionalText,
  text,
} from "./common";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");
const window = z
  .object({ start: time, end: time })
  .refine((w) => w.end > w.start, { message: "End time must be after start time" });
const day = z.object({
  enabled: boolish,
  start: time.optional(),
  end: time.optional(),
  slots: z.array(window).max(4).optional(),
});
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const nullableNumber = (min: number, max: number, int = false) =>
  z.preprocess(
    (v) => (v === "" ? null : v),
    (int ? z.coerce.number().int() : z.coerce.number().finite()).min(min).max(max).nullable().optional()
  );

export const updateProfileBody = z.object({
  skills: nullableText(500),
  serviceAreas: nullableText(500),
  bio: nullableText(2000),
  city: nullableText(80),
  lat: nullableNumber(-90, 90),
  lng: nullableNumber(-180, 180),
  yearsExperience: nullableNumber(0, 80, true),
  hourlyRateMin: nullableNumber(0, 1_000_000),
  hourlyRateMax: nullableNumber(0, 1_000_000),
  galleryUrls: z.array(fileRefString).max(12).optional(),
  weeklyAvailability: z
    .object(Object.fromEntries(DAYS.map((d) => [d, day.optional()])) as Record<(typeof DAYS)[number], z.ZodOptional<typeof day>>)
    .nullable()
    .optional(),
  blockedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")).max(60).optional(),
  notInterestedCategories: z.array(enumOf(JobCategory)).max(20).optional(),
  customRatePackages: z
    .array(
      z
        .object({
          id: text(64).optional(),
          label: text(80).min(1),
          hint: optionalText(160),
          amountMin: z.coerce.number().finite().min(0).max(10_000_000).transform(Math.round),
          amountMax: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().finite().min(0).max(10_000_000).nullable().optional()),
          unit: optionalText(40),
        })
        .refine((p) => p.amountMax == null || p.amountMax >= p.amountMin, { message: "Maximum can't be below minimum", path: ["amountMax"] })
        .transform((p) => ({ ...p, id: p.id || `pkg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` }))
    )
    .max(12)
    .optional(),
  caseStudies: z
    .array(
      z.object({
        id: text(64).min(1),
        title: text(120).min(1),
        notes: optionalText(800),
        beforeUrl: z.preprocess((v) => (v === "" ? null : v), fileRefString.nullable().optional()),
        afterUrl: z.preprocess((v) => (v === "" ? null : v), fileRefString.nullable().optional()),
        category: z.preprocess((v) => (v === "" ? null : v), text(40).nullable().optional()),
      })
    )
    .max(12)
    .optional(),
});

export const browseQuery = z.object({
  q: optionalText(100),
  city: optionalText(80),
  neighborhood: optionalText(80),
  area: optionalText(80),
  skill: optionalText(60),
  category: optionalText(60),
  verified: z.enum(["0", "1"]).optional(),
  ratingMin: optionalNumber(0, 5),
  rateMax: optionalNonNegativeMoney,
  nearLat: latitude,
  nearLng: longitude,
  maxKm: optionalNumber(0, 500),
  sort: z.enum(["rating", "distance", "heat"]).optional(),
  siteType: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["residential", "office"], { message: "Invalid siteType" }).optional()),
  slaTier: optionalText(30),
  maxResponseHours: optionalNumber(0, 1000),
  availableThisWeek: boolish.optional(),
  minHeat: optionalNumber(0, 100),
  minAvailabilityScore: optionalNumber(0, 100),
  limit: limit(40),
}).transform((q) => ({ ...q, minHeat: q.minHeat ?? q.minAvailabilityScore }));

export { optionalInt };
