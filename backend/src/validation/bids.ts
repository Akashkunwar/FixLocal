import { z } from "zod";
import { boolish, id, money, optionalDate, optionalInt, optionalMoney, optionalText } from "./common";

export const bidIdParams = z.object({ id });

export const placeBidBody = z.object({
  amount: money,
  message: optionalText(2000),
  etaDays: optionalInt(0, 365),
  proposedVisitStart: optionalDate,
  proposedVisitEnd: optionalDate,
  quoteAmount: optionalMoney,
  quoteNotes: optionalText(4000),
});

export const acceptBidBody = z.object({
  expectedAmount: money,
  expectedRevision: z.coerce.number().int().min(0),
});

export const updateQuoteBody = z.object({
  quoteAmount: optionalMoney,
  quoteNotes: z.preprocess((v) => (v === null ? "" : v), z.string().trim().max(4000).optional()),
  clearQuoteAttachment: boolish.optional(),
});

export const counterOfferBody = z.object({
  suggestedAmount: money,
  notes: optionalText(2000),
});

export const declineCounterBody = z.object({ notes: optionalText(2000) });

export const whatIfQuery = z.object({ amount: optionalMoney });

export const counterAnalyticsQuery = z.object({
  jobId: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
  homeownerId: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
  tradespersonId: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
  asPro: boolish.optional(),
});
