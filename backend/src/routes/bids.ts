import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { UserRole } from "../entities/User";
import { acceptBid, withdrawBid, updateBidQuote, requestQuoteRevise, markQuoteViewed, declineCounterOffer, checkViewedNoReply, escrowWhatIf, getCounterAnalytics } from "../controllers/bidController";
import { uploadQuoteAttachment } from "../middleware/upload";

const router = Router();

function handleQuoteUpload(req: Request, res: Response, next: NextFunction) {
  const ct = String(req.headers["content-type"] || "");
  if (!ct.includes("multipart/form-data")) return next();
  uploadQuoteAttachment(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || "Upload failed", code: "UPLOAD_ERROR" });
    }
    next();
  });
}

router.get("/counter-analytics", requireAuth, getCounterAnalytics);
router.get("/:id/escrow-what-if", requireAuth, escrowWhatIf);
router.post("/:id/escrow-what-if", requireAuth, escrowWhatIf);
router.post("/:id/accept", requireAuth, requireRole(UserRole.HOMEOWNER), acceptBid);
router.patch(
  "/:id/quote",
  requireAuth,
  requireRole(UserRole.TRADESPERSON),
  handleQuoteUpload,
  updateBidQuote
);
router.post(
  "/:id/counter-offer",
  requireAuth,
  requireRole(UserRole.HOMEOWNER),
  requestQuoteRevise
);
router.post(
  "/:id/quote-viewed",
  requireAuth,
  requireRole(UserRole.HOMEOWNER),
  markQuoteViewed
);
router.post(
  "/:id/counter-offer/decline",
  requireAuth,
  requireRole(UserRole.TRADESPERSON),
  declineCounterOffer
);
router.post(
  "/:id/viewed-no-reply",
  requireAuth,
  checkViewedNoReply
);
router.delete("/:id", requireAuth, requireRole(UserRole.TRADESPERSON), withdrawBid);

export default router;
