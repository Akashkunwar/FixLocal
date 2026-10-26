import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { validate } from "../middleware/validate";
import { UserRole } from "../entities/User";
import * as a from "../controllers/jobAlertController";
import * as s from "../validation/jobAlerts";
import { idParams } from "../validation/common";

const router = Router();
router.use(requireAuth, requireRole(UserRole.TRADESPERSON));

router.get("/", a.listJobAlerts);
router.post("/", validate({ body: s.jobAlertBody }), a.createJobAlert);
// POST because the criteria are a body, but it only reads.
router.post("/preview", validate({ body: s.previewJobAlertBody }), a.previewJobAlert);
router.patch("/:id", validate({ params: idParams, body: s.updateJobAlertBody }), a.updateJobAlert);
router.delete("/:id", validate({ params: idParams }), a.deleteJobAlert);

export default router;
