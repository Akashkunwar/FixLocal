import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { validate } from "../middleware/validate";
import { UserRole } from "../entities/User";
import * as reviews from "../controllers/reviewController";
import { createReviewBody, jobIdOnlyParams, userIdParams } from "../validation/misc";

const router = Router();
router.use(requireAuth);

router.post("/", requireRole(UserRole.HOMEOWNER, UserRole.TRADESPERSON), validate({ body: createReviewBody }), reviews.createReview);
router.get("/pro/:userId", validate({ params: userIdParams }), reviews.listReviewsForPro);
router.get("/client/:userId", validate({ params: userIdParams }), reviews.listReviewsForClient);
router.get("/job/:jobId", validate({ params: jobIdOnlyParams }), reviews.getJobReview);

export default router;
