import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { UserRole } from "../entities/User";
import { uploadEvidence } from "../middleware/upload";
import {
  createDispute,
  listDisputes,
  resolveDispute,
} from "../controllers/disputeController";

const router = Router();

function handleEvidence(req: Request, res: Response, next: NextFunction) {
  uploadEvidence(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || "Upload failed", code: "UPLOAD_ERROR" });
    }
    next();
  });
}

router.post(
  "/",
  requireAuth,
  requireRole(UserRole.HOMEOWNER, UserRole.TRADESPERSON),
  handleEvidence,
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
