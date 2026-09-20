import { z } from "zod";
import { DisputeResolution, DisputeStatus } from "../entities/Dispute";
import { FavoriteTargetType } from "../entities/Favorite";
import { boolish, enumOf, fileRefString, id, isoDate, limit, optionalText, page, requiredText } from "./common";

// ---- disputes ----
export const createDisputeBody = z.object({ reason: requiredText(4000) });
export const legacyDisputeBody = z.object({ jobId: id, reason: requiredText(4000) });
export const listDisputesQuery = z.object({
  status: z.preprocess((v) => (v === "" ? undefined : v), enumOf(DisputeStatus, "Invalid status").optional()),
  jobId: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
  page,
  limit: limit(100),
});
export const resolveDisputeBody = z.object({
  resolution: enumOf(DisputeResolution, "Choose a resolution"),
  resolutionNotes: optionalText(2000),
  refundMilestoneIds: z.preprocess(
    (v) => (typeof v === "string" && v ? [v] : v),
    z.array(id).max(10).optional()
  ),
  jobStatus: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v === "in_progress" ? "restore" : v),
    z.enum(["cancelled", "completed", "restore"]).optional()
  ),
});

// ---- reviews ----
export const createReviewBody = z.object({
  jobId: id,
  rating: z.coerce.number().int("Rating must be a whole number").min(1).max(5),
  comment: optionalText(2000),
});
export const userIdParams = z.object({ userId: id });
export const jobIdOnlyParams = z.object({ jobId: id });

// ---- messages ----
export const threadQuery = z.object({
  pro: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
  before: z.preprocess((v) => (v === "" ? undefined : v), isoDate.optional()),
  limit: limit(100),
  ticket: z.string().max(200).optional(),
});
export const sendMessageBody = z
  .object({
    body: optionalText(4000),
    quoteAmount: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().finite().gt(0).max(10_000_000).optional()),
    quoteNotes: optionalText(2000),
    quote: z.unknown().optional(),
  })
  .transform((v) => {
    // Older clients send the quote as a JSON object/string in "quote".
    let q = v.quote as unknown;
    if (typeof q === "string" && q.trim()) {
      try {
        q = JSON.parse(q);
      } catch {
        q = null;
      }
    }
    const legacy = q && typeof q === "object" ? (q as { amount?: unknown; notes?: unknown }) : null;
    const legacyAmount = legacy?.amount != null ? Number(legacy.amount) : undefined;
    return {
      body: v.body,
      quoteAmount: v.quoteAmount ?? (legacyAmount && legacyAmount > 0 && legacyAmount <= 10_000_000 ? legacyAmount : undefined),
      quoteNotes: v.quoteNotes ?? (legacy?.notes ? String(legacy.notes).slice(0, 2000) : undefined),
    };
  });

// ---- notifications ----
export const listNotificationsQuery = z.object({
  unread: boolish.optional(),
  limit: limit(50),
  before: z.preprocess((v) => (v === "" ? undefined : v), isoDate.optional()),
  ticket: z.string().max(200).optional(),
});

// ---- favorites ----
const favTarget = {
  targetType: z.enum([FavoriteTargetType.JOB, FavoriteTargetType.PRO], { message: "targetType must be job or pro" }),
  targetId: id,
};
const tags = z.preprocess(
  (v) => (typeof v === "string" ? v.split(/[,#]/) : v),
  z
    .array(z.string())
    .max(30)
    .transform((arr) =>
      [...new Set(arr.map((t) => t.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32)).filter(Boolean))].slice(0, 12)
    )
);
const notes = z.preprocess((v) => (v === "" ? null : v), z.string().trim().max(500).nullable().optional());
export const addFavoriteBody = z.object({ ...favTarget, notes, tags: tags.optional() });
export const updateFavoriteBody = z.object({ ...favTarget, notes, tags: tags.optional() });
export const favoriteQuery = z.object(favTarget);
export const listFavoritesQuery = z.object({
  type: z.preprocess((v) => (v === "" ? undefined : v), z.enum([FavoriteTargetType.JOB, FavoriteTargetType.PRO]).optional()),
});

// ---- reports ----
export const createReportBody = z.object({
  targetType: z.enum(["job", "user", "message"]),
  targetId: id,
  reason: requiredText(2000),
});
export const listReportsQuery = z.object({
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["open", "resolved", "dismissed"]).optional()),
  page,
  limit: limit(100),
});
export const resolveReportBody = z.object({
  status: z.enum(["resolved", "dismissed"]),
  resolutionNote: optionalText(2000),
});

// ---- gallery ----
export const removeGalleryBody = z.object({ url: fileRefString });

export { boolish };
