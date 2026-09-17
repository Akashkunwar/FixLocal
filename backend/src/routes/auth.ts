import { Router } from "express";
import * as auth from "../controllers/authController";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { limiter } from "../middleware/rateLimit";
import { uploadSingleImage } from "../middleware/upload";
import * as s from "../validation/auth";

const router = Router();

router.post("/register", limiter("register"), validate({ body: s.registerBody }), auth.register);
router.post("/login", limiter("login"), limiter("loginHourly"), validate({ body: s.loginBody }), auth.login);
router.post("/refresh", limiter("refresh"), auth.refresh);
router.post("/logout", auth.logout);
router.post("/logout-all", requireAuth, auth.logoutEverywhere);
router.post("/sse-ticket", requireAuth, auth.sseTicket);
router.post("/verify-email", limiter("passwordReset"), validate({ body: s.tokenBody }), auth.verifyEmail);
router.post("/resend-verification", requireAuth, limiter("passwordReset"), auth.resendVerification);
router.post("/forgot-password", limiter("passwordReset"), validate({ body: s.emailBody }), auth.forgotPassword);
router.post("/reset-password", limiter("passwordReset"), validate({ body: s.resetPasswordBody }), auth.resetPassword);
router.post("/change-password", requireAuth, limiter("login"), validate({ body: s.changePasswordBody }), auth.changePassword);

router.get("/me", requireAuth, auth.me);
router.patch("/me", requireAuth, validate({ body: s.updateMeBody }), auth.updateMe);
router.delete("/me", requireAuth, validate({ body: s.deleteAccountBody }), auth.deleteAccount);
router.post("/me/avatar", requireAuth, limiter("uploads"), uploadSingleImage, auth.uploadAvatar);
router.get("/me/templates", requireAuth, auth.listTemplates);
router.put(
  "/me/templates/:kind",
  requireAuth,
  validate({ params: auth.templateKindParams, body: s.templatesBody }),
  auth.replaceTemplates
);

export default router;
