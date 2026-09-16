import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { UserRole } from "../entities/User";
import { uploadJobPhotos, uploadCompletionPhotos, uploadQuoteAttachment } from "../middleware/upload";
import { listJobs, createJob, getJob, updateJob, cancelJob, suggestedProsForJob, inviteSuggestedPro, declineJobInvite, listJobInvites, bulkInviteSuggestedPros, markInviteOpened, getJobInviteAnalytics, getHomeownerInviteAnalytics, shortlistRankedForJob, getShortlistInviteAnalytics, getHomeownerShortlistInviteAnalytics } from "../controllers/jobController";
import { placeBid, listBids, getCounterAnalytics } from "../controllers/bidController";
import { startJob, completeJob } from "../controllers/jobStatusController";
import {
  listMilestones,
  releaseMilestone,
} from "../controllers/paymentController";
import {
  proposeSchedule,
  acceptSchedule,
  getSchedule,
} from "../controllers/scheduleController";
import {
  uploadCompletionPhotos as uploadCompletionPhotosHandler,
  removeCompletionPhoto,
} from "../controllers/completionPhotosController";
import {
  proposeAmc,
  replyAmc,
  requestAmc,
  replyAmcRequest,
} from "../controllers/amcProposalController";
import { publishCaseStudyFromJob } from "../controllers/publishCaseStudyController";

const router = Router();

function handleUpload(req: Request, res: Response, next: NextFunction) {
  uploadJobPhotos(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || "Upload failed", code: "UPLOAD_ERROR" });
    }
    next();
  });
}

function handleCompletionUpload(req: Request, res: Response, next: NextFunction) {
  uploadCompletionPhotos(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || "Upload failed", code: "UPLOAD_ERROR" });
    }
    next();
  });
}


function handleQuoteUpload(req: Request, res: Response, next: NextFunction) {
  // JSON body bids skip multer; multipart uses quoteAttachment field
  const ct = String(req.headers["content-type"] || "");
  if (!ct.includes("multipart/form-data")) return next();
  uploadQuoteAttachment(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || "Upload failed", code: "UPLOAD_ERROR" });
    }
    next();
  });
}

router.get("/", requireAuth, listJobs);
router.get("/invite-analytics", requireAuth, requireRole(UserRole.HOMEOWNER, UserRole.ADMIN), getHomeownerInviteAnalytics);
router.get("/shortlist-invite-analytics", requireAuth, requireRole(UserRole.HOMEOWNER, UserRole.ADMIN), getHomeownerShortlistInviteAnalytics);
router.get("/counter-analytics", requireAuth, getCounterAnalytics);
router.post("/", requireAuth, requireRole(UserRole.HOMEOWNER), handleUpload, createJob);
router.get("/:id/suggested-pros", requireAuth, requireRole(UserRole.HOMEOWNER, UserRole.ADMIN), suggestedProsForJob);
router.get("/:id/shortlist-ranked", requireAuth, requireRole(UserRole.HOMEOWNER, UserRole.ADMIN), shortlistRankedForJob);
router.get("/:id/shortlist-invite-analytics", requireAuth, requireRole(UserRole.HOMEOWNER, UserRole.ADMIN), getShortlistInviteAnalytics);
router.post("/:id/invite-pro", requireAuth, requireRole(UserRole.HOMEOWNER, UserRole.ADMIN), inviteSuggestedPro);
router.post("/:id/invite-pros", requireAuth, requireRole(UserRole.HOMEOWNER, UserRole.ADMIN), bulkInviteSuggestedPros);
router.get("/:id/invites", requireAuth, requireRole(UserRole.HOMEOWNER, UserRole.ADMIN), listJobInvites);
router.get("/:id/invite-analytics", requireAuth, requireRole(UserRole.HOMEOWNER, UserRole.ADMIN), getJobInviteAnalytics);
router.post("/:id/invite-opened", requireAuth, requireRole(UserRole.TRADESPERSON), markInviteOpened);
router.post("/:id/decline-invite", requireAuth, requireRole(UserRole.TRADESPERSON), declineJobInvite);
router.get("/:id/bids", requireAuth, listBids);
router.post("/:id/bids", requireAuth, requireRole(UserRole.TRADESPERSON), handleQuoteUpload, placeBid);
router.post("/:id/start", requireAuth, requireRole(UserRole.TRADESPERSON), startJob);
router.post("/:id/complete", requireAuth, completeJob);
router.post(
  "/:id/completion-photos",
  requireAuth,
  handleCompletionUpload,
  uploadCompletionPhotosHandler
);
router.delete("/:id/completion-photos", requireAuth, removeCompletionPhoto);
router.post(
  "/:id/publish-case-study",
  requireAuth,
  requireRole(UserRole.TRADESPERSON, UserRole.ADMIN),
  publishCaseStudyFromJob
);
router.post(
  "/:id/amc-proposal",
  requireAuth,
  requireRole(UserRole.TRADESPERSON, UserRole.ADMIN),
  proposeAmc
);
router.post(
  "/:id/amc-proposal/reply",
  requireAuth,
  requireRole(UserRole.HOMEOWNER, UserRole.ADMIN),
  replyAmc
);

router.post(
  "/:id/amc-request",
  requireAuth,
  requireRole(UserRole.HOMEOWNER, UserRole.ADMIN),
  requestAmc
);
router.post(
  "/:id/amc-request/reply",
  requireAuth,
  requireRole(UserRole.TRADESPERSON, UserRole.ADMIN),
  replyAmcRequest
);


router.get("/:id/payments", requireAuth, listMilestones);
router.post(
  "/:id/payments/:milestoneId/release",
  requireAuth,
  requireRole(UserRole.HOMEOWNER, UserRole.ADMIN),
  releaseMilestone
);

router.get("/:id/schedule", requireAuth, getSchedule);
router.post("/:id/schedule/propose", requireAuth, proposeSchedule);
router.post("/:id/schedule/accept", requireAuth, acceptSchedule);

router.get("/:id", requireAuth, getJob);
router.patch("/:id", requireAuth, requireRole(UserRole.HOMEOWNER), handleUpload, updateJob);
router.post("/:id/cancel", requireAuth, requireRole(UserRole.HOMEOWNER), cancelJob);

export default router;
