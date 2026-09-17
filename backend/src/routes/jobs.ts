import { Router } from "express";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { validate } from "../middleware/validate";
import { limiter } from "../middleware/rateLimit";
import { idempotent } from "../middleware/idempotency";
import { optionalMultipart, uploadCompletionPhotos, uploadEvidence, uploadJobPhotos, uploadQuoteAttachment } from "../middleware/upload";
import { UserRole } from "../entities/User";
import * as jobs from "../controllers/jobController";
import * as invites from "../controllers/inviteController";
import * as match from "../controllers/matchController";
import * as status from "../controllers/jobStatusController";
import * as payments from "../controllers/paymentController";
import * as schedule from "../controllers/scheduleController";
import * as photos from "../controllers/completionPhotosController";
import * as amc from "../controllers/amcProposalController";
import * as disputes from "../controllers/disputeController";
import { publishCaseStudyFromJob } from "../controllers/publishCaseStudyController";
import { getCounterAnalytics, listBids, placeBid } from "../controllers/bidController";
import { authorizeJobOwner } from "../policies/routeGuards";
import * as js from "../validation/jobs";
import { counterAnalyticsQuery, placeBidBody } from "../validation/bids";
import { createDisputeBody } from "../validation/misc";

const HOMEOWNER = UserRole.HOMEOWNER;
const PRO = UserRole.TRADESPERSON;
const ADMIN = UserRole.ADMIN;
const params = validate({ params: js.jobIdParams });

const router = Router();
router.use(requireAuth);

router.get("/", validate({ query: js.listJobsQuery }), jobs.listJobs);
router.post(
  "/",
  requireRole(HOMEOWNER),
  requireVerifiedEmail,
  limiter("uploads"),
  optionalMultipart(uploadJobPhotos),
  validate({ body: js.createJobBody }),
  jobs.createJob
);
router.get("/invite-analytics", requireRole(HOMEOWNER, ADMIN), validate({ query: js.analyticsOwnerQuery }), invites.getHomeownerInviteAnalytics);
router.get(
  "/shortlist-invite-analytics",
  requireRole(HOMEOWNER, ADMIN),
  validate({ query: js.analyticsOwnerQuery }),
  invites.getHomeownerShortlistInviteAnalytics
);
router.get("/counter-analytics", requireRole(HOMEOWNER, ADMIN), validate({ query: counterAnalyticsQuery }), getCounterAnalytics);

router.get("/:id", params, jobs.getJob);
router.patch(
  "/:id",
  requireRole(HOMEOWNER),
  params,
  authorizeJobOwner,
  optionalMultipart(uploadJobPhotos),
  validate({ params: js.jobIdParams, body: js.updateJobBody }),
  jobs.updateJob
);
router.post("/:id/cancel", requireRole(HOMEOWNER), params, jobs.cancelJob);
router.post("/:id/photo-consent", requireRole(HOMEOWNER), validate({ params: js.jobIdParams, body: js.photoConsentBody }), jobs.setPhotoConsent);

router.get("/:id/suggested-pros", requireRole(HOMEOWNER, ADMIN), validate({ params: js.jobIdParams, query: js.suggestedQuery }), match.suggestedProsForJob);
router.get("/:id/shortlist-ranked", requireRole(HOMEOWNER, ADMIN), params, match.shortlistRankedForJob);

router.get("/:id/invites", requireRole(HOMEOWNER, ADMIN), params, invites.listJobInvites);
router.get("/:id/invite-analytics", requireRole(HOMEOWNER, ADMIN), params, invites.getJobInviteAnalytics);
router.get("/:id/shortlist-invite-analytics", requireRole(HOMEOWNER, ADMIN), params, invites.getShortlistInviteAnalytics);
router.post("/:id/invite-pro", requireRole(HOMEOWNER, ADMIN), limiter("invites"), validate({ params: js.jobIdParams, body: js.inviteBody }), invites.inviteSuggestedPro);
router.post("/:id/invite-pros", requireRole(HOMEOWNER, ADMIN), limiter("invites"), validate({ params: js.jobIdParams, body: js.bulkInviteBody }), invites.bulkInviteSuggestedPros);
router.post("/:id/invite-opened", requireRole(PRO), params, invites.markInviteOpened);
router.post("/:id/decline-invite", requireRole(PRO), validate({ params: js.jobIdParams, body: js.declineInviteBody }), invites.declineJobInvite);

router.get("/:id/bids", params, listBids);
router.post(
  "/:id/bids",
  requireRole(PRO),
  requireVerifiedEmail,
  params,
  optionalMultipart(uploadQuoteAttachment),
  validate({ params: js.jobIdParams, body: placeBidBody }),
  placeBid
);

router.post("/:id/start", requireRole(PRO), params, status.startJob);
router.post("/:id/mark-done", requireRole(PRO), params, status.markDone);
router.post("/:id/confirm", requireRole(HOMEOWNER, ADMIN), params, idempotent, status.confirmComplete);
router.post("/:id/complete", params, idempotent, status.completeJob);

router.post(
  "/:id/completion-photos",
  params,
  photos.authorizeCompletionUpload,
  limiter("uploads"),
  uploadCompletionPhotos,
  photos.uploadCompletionPhotos
);
router.delete("/:id/completion-photos", validate({ params: js.jobIdParams, body: js.removeCompletionPhotoBody }), photos.removeCompletionPhoto);
router.post(
  "/:id/publish-case-study",
  requireRole(PRO, ADMIN),
  validate({ params: js.jobIdParams, body: js.publishCaseStudyBody }),
  publishCaseStudyFromJob
);

router.post("/:id/amc-proposal", requireRole(PRO, ADMIN), validate({ params: js.jobIdParams, body: js.amcProposalBody }), amc.proposeAmc);
router.post("/:id/amc-proposal/reply", requireRole(HOMEOWNER, ADMIN), validate({ params: js.jobIdParams, body: js.amcReplyBody }), amc.replyAmc);
router.post("/:id/amc-request", requireRole(HOMEOWNER, ADMIN), validate({ params: js.jobIdParams, body: js.amcProposalBody }), amc.requestAmc);
router.post("/:id/amc-request/reply", requireRole(PRO, ADMIN), validate({ params: js.jobIdParams, body: js.amcReplyBody }), amc.replyAmcRequest);

router.get("/:id/payments", params, payments.listMilestones);
router.post(
  "/:id/payments/:milestoneId/release",
  requireRole(HOMEOWNER, ADMIN),
  validate({ params: js.milestoneParams }),
  idempotent,
  payments.releaseMilestone
);

router.get("/:id/schedule", params, schedule.getSchedule);
router.post("/:id/schedule/propose", validate({ params: js.jobIdParams, body: js.scheduleProposeBody }), schedule.proposeSchedule);
router.post("/:id/schedule/accept", params, schedule.acceptSchedule);

router.post(
  "/:id/disputes",
  requireRole(HOMEOWNER, PRO),
  params,
  disputes.authorizeDispute,
  limiter("uploads"),
  optionalMultipart(uploadEvidence),
  validate({ params: js.jobIdParams, body: createDisputeBody }),
  disputes.createDispute
);

export default router;
