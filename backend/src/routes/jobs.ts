import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { UserRole } from "../entities/User";
import { uploadJobPhotos } from "../middleware/upload";
import { listJobs, createJob, getJob, updateJob, cancelJob } from "../controllers/jobController";
import { placeBid, listBids } from "../controllers/bidController";
import { startJob, completeJob } from "../controllers/jobStatusController";

const router = Router();

function handleUpload(req: Request, res: Response, next: NextFunction) {
  uploadJobPhotos(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || "Upload failed", code: "UPLOAD_ERROR" });
    }
    next();
  });
}

router.get("/", requireAuth, listJobs);
router.post("/", requireAuth, requireRole(UserRole.HOMEOWNER), handleUpload, createJob);
router.get("/:id/bids", requireAuth, listBids);
router.post("/:id/bids", requireAuth, requireRole(UserRole.TRADESPERSON), placeBid);
router.post("/:id/start", requireAuth, requireRole(UserRole.TRADESPERSON), startJob);
router.post("/:id/complete", requireAuth, completeJob);
router.get("/:id", requireAuth, getJob);
router.patch("/:id", requireAuth, requireRole(UserRole.HOMEOWNER), handleUpload, updateJob);
router.post("/:id/cancel", requireAuth, requireRole(UserRole.HOMEOWNER), cancelJob);

export default router;
