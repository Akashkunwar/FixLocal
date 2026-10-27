import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { validate } from "../middleware/validate";
import { UserRole } from "../entities/User";
import * as reviews from "../controllers/reviewController";
import { createReviewBody, jobIdOnlyParams, reviewReplyBody, userIdParams } from "../validation/misc";
import { idParams } from "../validation/common";

const router = Router();
router.use(requireAuth);

router.post("/", requireRole(UserRole.HOMEOWNER, UserRole.TRADESPERSON), validate({ body: createReviewBody }), reviews.createReview);
router.get("/pending", requireRole(UserRole.HOMEOWNER, UserRole.TRADESPERSON), reviews.listPendingReviews);
router.get("/pro/:userId", validate({ params: userIdParams }), reviews.listReviewsForPro);
router.get("/client/:userId", validate({ params: userIdParams }), reviews.listReviewsForClient);
router.put(
  "/:id/reply",
  requireRole(UserRole.HOMEOWNER, UserRole.TRADESPERSON),
  validate({ params: idParams, body: reviewReplyBody }),
  reviews.replyToReview
);
router.get("/job/:jobId", validate({ params: jobIdOnlyParams }), reviews.getJobReview);

export default router;
