import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { UserRole } from "../entities/User";
import { uploadGalleryPhotos } from "../middleware/upload";
import {
  getMyProfile,
  updateMyProfile,
  getPublicProfile,
  browsePros,
  uploadGallery,
  removeGalleryImage,
  getMyEarnings,
  getMyAnalytics,
} from "../controllers/profileController";
import { getCounterAnalytics } from "../controllers/bidController";

const router = Router();

function handleGalleryUpload(req: Request, res: Response, next: NextFunction) {
  uploadGalleryPhotos(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || "Upload failed", code: "UPLOAD_ERROR" });
    }
    next();
  });
}

router.get("/browse", requireAuth, browsePros);
router.get("/earnings", requireAuth, requireRole(UserRole.TRADESPERSON), getMyEarnings);
router.get("/analytics", requireAuth, requireRole(UserRole.TRADESPERSON), getMyAnalytics);
router.get("/counter-analytics", requireAuth, requireRole(UserRole.TRADESPERSON, UserRole.ADMIN), getCounterAnalytics);
router.get("/user/:userId", requireAuth, getPublicProfile);
router.get("/", requireAuth, requireRole(UserRole.TRADESPERSON), getMyProfile);
router.patch("/", requireAuth, requireRole(UserRole.TRADESPERSON), updateMyProfile);
router.post(
  "/gallery",
  requireAuth,
  requireRole(UserRole.TRADESPERSON),
  handleGalleryUpload,
  uploadGallery
);
router.delete(
  "/gallery",
  requireAuth,
  requireRole(UserRole.TRADESPERSON),
  removeGalleryImage
);

export default router;
