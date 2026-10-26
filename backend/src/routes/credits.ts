import { requireAuth } from "../middleware/auth";
import { Router } from "express";
import { UserRole } from "../entities/User";
import { requireRole } from "../middleware/rbac";
import { getMyCredits } from "../controllers/creditController";

const router = Router();
router.use(requireAuth, requireRole(UserRole.HOMEOWNER, UserRole.TRADESPERSON));
router.get("/me", getMyCredits);

export default router;
