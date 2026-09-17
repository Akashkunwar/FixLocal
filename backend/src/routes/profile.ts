import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { validate } from "../middleware/validate";
import { limiter } from "../middleware/rateLimit";
import { uploadGalleryPhotos, uploadLicenseDoc } from "../middleware/upload";
import { UserRole } from "../entities/User";
import * as profile from "../controllers/profileController";
import { getCounterAnalytics } from "../controllers/bidController";
import * as s from "../validation/profile";
import { removeGalleryBody, userIdParams } from "../validation/misc";
import { counterAnalyticsQuery } from "../validation/bids";

const PRO = UserRole.TRADESPERSON;
const router = Router();
router.use(requireAuth);

router.get("/browse", validate({ query: s.browseQuery }), profile.browsePros);
router.get("/earnings", requireRole(PRO), profile.getMyEarnings);
router.get("/analytics", requireRole(PRO), profile.getMyAnalytics);
router.get("/counter-analytics", requireRole(PRO, UserRole.ADMIN), validate({ query: counterAnalyticsQuery }), getCounterAnalytics);
router.get("/user/:userId", validate({ params: userIdParams }), profile.getPublicProfile);
router.get("/", requireRole(PRO), profile.getMyProfile);
router.patch("/", requireRole(PRO), validate({ body: s.updateProfileBody }), profile.updateMyProfile);
router.post("/gallery", requireRole(PRO), limiter("uploads"), uploadGalleryPhotos, profile.uploadGallery);
router.delete("/gallery", requireRole(PRO), validate({ body: removeGalleryBody }), profile.removeGalleryImage);
router.post("/license", requireRole(PRO), limiter("uploads"), uploadLicenseDoc, profile.uploadLicense);

export default router;
