import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { UserRole } from "../entities/User";
import { acceptBid, withdrawBid } from "../controllers/bidController";

const router = Router();

router.post("/:id/accept", requireAuth, requireRole(UserRole.HOMEOWNER), acceptBid);
router.delete("/:id", requireAuth, requireRole(UserRole.TRADESPERSON), withdrawBid);

export default router;
