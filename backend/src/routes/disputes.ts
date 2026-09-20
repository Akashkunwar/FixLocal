import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { validate } from "../middleware/validate";
import { idempotent } from "../middleware/idempotency";
import { UserRole } from "../entities/User";
import * as disputes from "../controllers/disputeController";
import { idParams } from "../validation/common";
import * as s from "../validation/misc";

const router = Router();
router.use(requireAuth);

// Legacy JSON-only route; evidence uploads go to POST /api/jobs/:id/disputes.
router.post(
  "/",
  requireRole(UserRole.HOMEOWNER, UserRole.TRADESPERSON),
  disputes.rejectLegacyMultipart,
  validate({ body: s.legacyDisputeBody }),
  disputes.createDispute
);
router.get("/", validate({ query: s.listDisputesQuery }), disputes.listDisputes);
router.patch(
  "/:id/resolve",
  requireRole(UserRole.ADMIN),
  validate({ params: idParams, body: s.resolveDisputeBody }),
  idempotent,
  disputes.resolveDispute
);

export default router;
