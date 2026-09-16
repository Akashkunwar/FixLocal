import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { UserRole } from "../entities/User";
import { createReview, listReviewsForPro, getJobReview } from "../controllers/reviewController";

const router = Router();

router.post("/", requireAuth, requireRole(UserRole.HOMEOWNER), createReview);
router.get("/pro/:userId", requireAuth, listReviewsForPro);
router.get("/job/:jobId", requireAuth, getJobReview);

export default router;
