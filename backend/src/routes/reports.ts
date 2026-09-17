import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { limiter } from "../middleware/rateLimit";
import { createReport } from "../controllers/reportController";
import { createReportBody } from "../validation/misc";

const router = Router();
router.post("/", requireAuth, limiter("reports"), validate({ body: createReportBody }), createReport);

export default router;
