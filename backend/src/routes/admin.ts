import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { UserRole } from "../entities/User";
import {
  verifyTradesperson,
  listTradespeople,
  adminStats,
  forceCancelJob,
  listUsers,
  setUserSuspended,
  listAuditLogs,
  createAdminNote,
  matchQualityLite,
  getMatchWeightsConfig,
  updateMatchWeightsConfig,
  rollbackMatchWeightsFromAudit,
  rollbackBestValueBlendFromAudit,
  previewBestValueBlend,
} from "../controllers/adminController";

const router = Router();

router.use(requireAuth, requireRole(UserRole.ADMIN));

router.get("/ping", (_req, res) => {
  res.json({ message: "admin ok" });
});

router.get("/stats", adminStats);
router.get("/match-quality", matchQualityLite);
router.get("/match-weights", getMatchWeightsConfig);
router.put("/match-weights", updateMatchWeightsConfig);
router.patch("/match-weights", updateMatchWeightsConfig);
router.post("/match-weights/rollback", rollbackMatchWeightsFromAudit);
router.post("/best-value-blend/rollback", rollbackBestValueBlendFromAudit);
router.get("/best-value-blend/preview", previewBestValueBlend);
router.post("/best-value-blend/preview", previewBestValueBlend);
router.get("/users", listUsers);
router.patch("/users/:id/suspend", setUserSuspended);
router.get("/tradespeople", listTradespeople);
router.patch("/tradespeople/:id/verify", verifyTradesperson);
router.post("/jobs/:id/force-cancel", forceCancelJob);
router.get("/audit-logs", listAuditLogs);
router.post("/audit-notes", createAdminNote);

export default router;
