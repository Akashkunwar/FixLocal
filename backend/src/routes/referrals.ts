import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { UserRole } from "../entities/User";
import { createMyReferralCode, getMyReferrals } from "../controllers/referralController";

const router = Router();
router.use(requireAuth, requireRole(UserRole.HOMEOWNER, UserRole.TRADESPERSON));

router.get("/me", getMyReferrals);
router.post("/me/code", createMyReferralCode);

export default router;
