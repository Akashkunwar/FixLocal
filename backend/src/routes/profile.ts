import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { UserRole } from "../entities/User";
import { getMyProfile, updateMyProfile } from "../controllers/profileController";

const router = Router();

router.get("/", requireAuth, requireRole(UserRole.TRADESPERSON), getMyProfile);
router.patch("/", requireAuth, requireRole(UserRole.TRADESPERSON), updateMyProfile);

export default router;
