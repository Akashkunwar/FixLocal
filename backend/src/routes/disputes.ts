import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { UserRole } from "../entities/User";
import {
  createDispute,
  listDisputes,
  resolveDispute,
} from "../controllers/disputeController";

const router = Router();

router.post(
  "/",
  requireAuth,
  requireRole(UserRole.HOMEOWNER, UserRole.TRADESPERSON),
  createDispute
);
router.get("/", requireAuth, listDisputes);
router.patch(
  "/:id/resolve",
  requireAuth,
  requireRole(UserRole.ADMIN),
  resolveDispute
);

export default router;
