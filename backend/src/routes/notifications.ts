import { Router } from "express";
import { requireAuth, requireStreamAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import * as n from "../controllers/notificationController";
import { idParams } from "../validation/common";
import { listNotificationsQuery } from "../validation/misc";

const router = Router();

router.get("/stream", validate({ query: listNotificationsQuery }), requireStreamAuth, n.streamNotifications);
router.use(requireAuth);
router.get("/", validate({ query: listNotificationsQuery }), n.listNotifications);
router.post("/read-all", n.markAllNotificationsRead);
router.patch("/:id/read", validate({ params: idParams }), n.markNotificationRead);

export default router;
