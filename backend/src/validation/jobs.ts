import { z } from "zod";
import { JobCategory, JobStatus } from "../entities/Job";
import {
  boolish,
  enumOf,
  fileRefString,
  id,
  jsonArray,
  latitude,
  limit,
  longitude,
  nullableText,
  optionalDate,
  optionalInt,
  optionalNonNegativeMoney,
  optionalNumber,
  optionalText,
  page,
  requiredText,
} from "./common";

export const SITE_TYPES = ["residential", "office"] as const;
export const CADENCES = ["one_time", "weekly", "monthly", "amc"] as const;

const pincode = z.preprocess(
  (v) => (v === "" ? null : v),
  z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z -]{3,10}$/, "Enter a valid PIN / postal code")
    .nullable()
    .optional()
);

const budgetOrder = (v: { budgetMin?: number | null; budgetMax?: number | null }) =>
  v.budgetMin == null || v.budgetMax == null || v.budgetMin <= v.budgetMax;
const dateOrder = (v: { preferredStart?: Date | null; preferredEnd?: Date | null }) =>
  !v.preferredStart || !v.preferredEnd || v.preferredEnd >= v.preferredStart;

export const createJobBody = z
  .object({
    title: requiredText(120),
    description: requiredText(5000),
    category: enumOf(JobCategory, "Choose a valid category"),
    siteType: z.preprocess((v) => (v === "" ? undefined : v), z.enum(SITE_TYPES).optional()),
    cadence: z.preprocess((v) => (v === "" ? undefined : v), z.enum(CADENCES).default("one_time")),
    cadenceNote: nullableText(500),
    preferredStart: optionalDate,
    preferredEnd: optionalDate,
    maxBids: z.preprocess((v) => (v === "" || v == null ? 5 : v), z.coerce.number().int().min(1).max(50)),
    budgetMin: optionalNonNegativeMoney,
    budgetMax: optionalNonNegativeMoney,
    address: optionalText(200),
    area: optionalText(80),
    city: optionalText(80),
    pincode,
    lat: latitude,
    lng: longitude,
  })
  .refine(budgetOrder, { message: "Minimum budget can't be above the maximum", path: ["budgetMin"] })
  .refine(dateOrder, { message: "End date must be after the start date", path: ["preferredEnd"] });

const nullable = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? null : v), schema.nullable().optional());

export const updateJobBody = z
  .object({
    title: requiredText(120).optional(),
    description: requiredText(5000).optional(),
    category: enumOf(JobCategory, "Choose a valid category").optional(),
    siteType: nullable(z.enum(SITE_TYPES)),
    cadence: z.preprocess((v) => (v === "" ? undefined : v), z.enum(CADENCES).optional()),
    cadenceNote: nullableText(500),
    preferredStart: nullable(z.coerce.date()),
    preferredEnd: nullable(z.coerce.date()),
    maxBids: optionalInt(1, 50),
    budgetMin: nullable(z.coerce.number().finite().min(0).max(10_000_000)),
    budgetMax: nullable(z.coerce.number().finite().min(0).max(10_000_000)),
    address: nullableText(200),
    area: nullableText(80),
    city: nullableText(80),
    pincode,
    lat: nullable(z.coerce.number().min(-90).max(90)),
    lng: nullable(z.coerce.number().min(-180).max(180)),
    removePhotoUrls: jsonArray(fileRefString, 10).optional(),
  })
  .refine(budgetOrder, { message: "Minimum budget can't be above the maximum", path: ["budgetMin"] })
  .refine(dateOrder, { message: "End date must be after the start date", path: ["preferredEnd"] });

export const listJobsQuery = z.object({
  q: optionalText(100),
  keyword: optionalText(100),
  category: z.preprocess((v) => (v === "" ? undefined : v), enumOf(JobCategory, "Invalid category").optional()),
  siteType: z.preprocess((v) => (v === "" ? undefined : v), z.enum(SITE_TYPES, { message: "Invalid siteType" }).optional()),
  status: z.preprocess((v) => (v === "" ? undefined : v), enumOf(JobStatus, "Invalid status").optional()),
  from: optionalDate,
  to: optionalDate,
  dateField: z.enum(["created", "preferred"]).default("created"),
  page: page,
  limit: limit(50),
  sort: z.enum(["newest", "budget_desc", "budget_asc", "preferred_date", "distance"]).default("newest"),
  scope: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["mine"]).optional()),
  area: optionalText(80),
  city: optionalText(80),
  neighborhood: optionalText(80),
  budgetMin: optionalNonNegativeMoney,
  budgetMax: optionalNonNegativeMoney,
  nearLat: latitude,
  nearLng: longitude,
  maxKm: optionalNumber(0, 500),
  mine: z.string().optional(),
});

export const jobIdParams = z.object({ id });
export const milestoneParams = z.object({ id, milestoneId: id });

export const photoConsentBody = z.object({ consent: boolish });

export const scheduleProposeBody = z
  .object({
    start: z.coerce.date({ message: "start must be a valid date" }),
    end: optionalDate,
    note: optionalText(500),
  })
  .refine((v) => v.start.getTime() > Date.now() - 3600_000, { message: "Visit can't start in the past", path: ["start"] })
  .refine((v) => !v.end || v.end > v.start, { message: "end must be after start", path: ["end"] })
  .refine((v) => !v.end || v.end.getTime() - v.start.getTime() <= 14 * 86400_000, {
    message: "A visit window can be at most 14 days",
    path: ["end"],
  });

export const removeCompletionPhotoBody = z.object({
  url: fileRefString,
  kind: z.enum(["before", "after"]),
});

export const publishCaseStudyBody = z.object({
  title: optionalText(120),
  notes: optionalText(800),
  beforeUrl: z.preprocess((v) => (v === "" ? undefined : v), fileRefString.optional()),
  afterUrl: z.preprocess((v) => (v === "" ? undefined : v), fileRefString.optional()),
  id: optionalText(64),
});

const AMC_CADENCES = ["weekly", "monthly", "amc"] as const;
const amcCadence = z.preprocess(
  (v) => (typeof v === "string" ? v.toLowerCase().trim() : v),
  z.enum(AMC_CADENCES).default("monthly")
);

export const amcProposalBody = z
  .object({
    cadence: amcCadence,
    packageLabel: requiredText(80),
    amountMin: z.coerce.number().finite().min(0).max(10_000_000).transform(Math.round),
    amountMax: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.coerce.number().finite().min(0).max(10_000_000).transform(Math.round).optional()
    ),
    unit: optionalText(40),
    note: optionalText(500),
  })
  .refine((v) => v.amountMax == null || v.amountMax >= v.amountMin, {
    message: "Maximum can't be below the minimum",
    path: ["amountMax"],
  });

export const amcReplyBody = z.object({
  action: z.enum(["accept", "decline", "counter"]),
  replyNote: optionalText(500),
  replyCadence: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(AMC_CADENCES).optional()),
  packageLabel: optionalText(80),
  amountMin: optionalNonNegativeMoney,
  amountMax: optionalNonNegativeMoney,
  unit: optionalText(40),
  cadence: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(AMC_CADENCES).optional()),
});

export const INVITE_SOURCES = ["shortlist", "suggested", "profile", "bulk", "other"] as const;

export const inviteBody = z.object({
  tradespersonId: id,
  message: optionalText(500),
  source: z.preprocess(
    (v) => (typeof v === "string" ? v.toLowerCase().trim() : v),
    z.enum(INVITE_SOURCES).default("suggested")
  ),
  shortlistRank: optionalInt(1, 1000),
  smartScore: optionalNumber(-1000, 1000),
  /** A stricter availability gate for shortlist invites (can raise the default, never lower it). */
  minHeat: optionalInt(0, 100),
});

export const bulkInviteBody = z.object({
  tradespersonIds: z.array(id).min(1, "Choose at least one professional").max(10),
  message: optionalText(500),
  source: z.preprocess(
    (v) => (typeof v === "string" ? v.toLowerCase().trim() : v),
    z.enum(INVITE_SOURCES).default("bulk")
  ),
  shortlistRanks: z.record(z.string(), z.coerce.number()).optional(),
  smartScores: z.record(z.string(), z.coerce.number()).optional(),
  minHeat: optionalInt(0, 100),
});

export const DECLINE_REASONS = ["busy", "schedule", "too_far", "rate", "specialty", "other"] as const;

export const declineInviteBody = z.object({
  note: optionalText(300),
  reason: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(DECLINE_REASONS).optional()),
});

export const analyticsOwnerQuery = z.object({
  homeownerId: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
});

export const suggestedQuery = z.object({ limit: limit(10) });
