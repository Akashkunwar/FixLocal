import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { validate } from "../middleware/validate";
import { UserRole } from "../entities/User";
import * as admin from "../controllers/adminController";
import * as reports from "../controllers/reportController";
import * as s from "../validation/admin";
import { idParams } from "../validation/common";
import { listReportsQuery, resolveReportBody } from "../validation/misc";

const router = Router();
router.use(requireAuth, requireRole(UserRole.ADMIN));

router.get("/ping", (_req, res) => {
  res.json({ message: "admin ok" });
});
router.get("/stats", admin.adminStats);
router.get("/match-quality", admin.matchQualityLite);
router.get("/match-weights", admin.getMatchWeightsConfig);
router.put("/match-weights", admin.updateMatchWeightsConfig);
router.patch("/match-weights", admin.updateMatchWeightsConfig);
router.post("/match-weights/rollback", validate({ body: s.rollbackBody }), admin.rollbackMatchWeightsFromAudit);
router.post("/best-value-blend/rollback", validate({ body: s.rollbackBody }), admin.rollbackBestValueBlendFromAudit);
router.get("/best-value-blend/preview", admin.previewBestValueBlend);
router.post("/best-value-blend/preview", admin.previewBestValueBlend);
router.get("/users", validate({ query: s.listUsersQuery }), admin.listUsers);
router.patch("/users/:id/suspend", validate({ params: idParams, body: s.suspendBody }), admin.setUserSuspended);
router.get("/tradespeople", validate({ query: s.listTradespeopleQuery }), admin.listTradespeople);
router.patch("/tradespeople/:id/verify", validate({ params: idParams, body: s.verifyBody }), admin.verifyTradesperson);
router.post("/jobs/:id/force-cancel", validate({ params: idParams, body: s.forceCancelBody }), admin.forceCancelJob);
router.get("/audit-logs", validate({ query: s.auditLogsQuery }), admin.listAuditLogs);
router.post("/audit-notes", validate({ body: s.adminNoteBody }), admin.createAdminNote);
router.get("/reports", validate({ query: listReportsQuery }), reports.listReports);
router.patch("/reports/:id", validate({ params: idParams, body: resolveReportBody }), reports.resolveReport);

export default router;
