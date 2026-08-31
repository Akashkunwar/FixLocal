import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { UserRole } from "../entities/User";
import {
  verifyTradesperson,
  listTradespeople,
  adminStats,
  forceCancelJob,
} from "../controllers/adminController";

const router = Router();

router.use(requireAuth, requireRole(UserRole.ADMIN));

router.get("/ping", (_req, res) => {
  res.json({ message: "admin ok" });
});

router.get("/stats", adminStats);
router.get("/tradespeople", listTradespeople);
router.patch("/tradespeople/:id/verify", verifyTradesperson);
router.post("/jobs/:id/force-cancel", forceCancelJob);

export default router;
