import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { validate } from "../middleware/validate";
import { idempotent } from "../middleware/idempotency";
import { optionalMultipart, uploadQuoteAttachment } from "../middleware/upload";
import { UserRole } from "../entities/User";
import * as bids from "../controllers/bidController";
import { authorizeBidOwner } from "../policies/routeGuards";
import * as s from "../validation/bids";

const router = Router();
router.use(requireAuth);
const params = validate({ params: s.bidIdParams });

router.get("/counter-analytics", validate({ query: s.counterAnalyticsQuery }), bids.getCounterAnalytics);
router.get("/:id/escrow-what-if", validate({ params: s.bidIdParams, query: s.whatIfQuery }), bids.escrowWhatIf);
router.post("/:id/accept", requireRole(UserRole.HOMEOWNER), validate({ params: s.bidIdParams, body: s.acceptBidBody }), idempotent, bids.acceptBid);
router.patch(
  "/:id/quote",
  requireRole(UserRole.TRADESPERSON),
  params,
  authorizeBidOwner,
  optionalMultipart(uploadQuoteAttachment),
  validate({ params: s.bidIdParams, body: s.updateQuoteBody }),
  bids.updateBidQuote
);
router.post("/:id/counter-offer", requireRole(UserRole.HOMEOWNER), validate({ params: s.bidIdParams, body: s.counterOfferBody }), bids.requestQuoteRevise);
router.post("/:id/quote-viewed", requireRole(UserRole.HOMEOWNER), params, bids.markQuoteViewed);
router.post(
  "/:id/counter-offer/decline",
  requireRole(UserRole.TRADESPERSON),
  validate({ params: s.bidIdParams, body: s.declineCounterBody }),
  bids.declineCounterOffer
);
router.get("/:id/viewed-no-reply", params, bids.checkViewedNoReply);
router.post("/:id/viewed-no-reply", params, bids.checkViewedNoReply);
router.delete("/:id", requireRole(UserRole.TRADESPERSON), params, bids.withdrawBid);

export default router;
