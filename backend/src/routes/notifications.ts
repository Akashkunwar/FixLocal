import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  streamNotifications,
} from "../controllers/notificationController";

const router = Router();

router.get("/", requireAuth, listNotifications);
router.get("/stream", requireAuth, streamNotifications);
router.post("/read-all", requireAuth, markAllNotificationsRead);
router.patch("/:id/read", requireAuth, markNotificationRead);

export default router;
