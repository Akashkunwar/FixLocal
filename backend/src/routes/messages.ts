import { Router } from "express";
import { requireAuth, requireStreamAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { limiter } from "../middleware/rateLimit";
import { optionalMultipart, uploadMessageAttachments } from "../middleware/upload";
import * as messages from "../controllers/messageController";
import { jobIdOnlyParams, sendMessageBody, threadQuery } from "../validation/misc";

const router = Router();
const thread = validate({ params: jobIdOnlyParams, query: threadQuery });

router.get("/:jobId/stream", thread, requireStreamAuth, messages.streamMessages);
router.use(requireAuth);
router.get("/:jobId/threads", thread, messages.listThreads);
router.get("/:jobId", thread, messages.listMessages);
router.post("/:jobId/read", thread, messages.markThreadRead);
router.post(
  "/:jobId",
  thread,
  limiter("messages"),
  messages.authorizeSend,
  optionalMultipart(uploadMessageAttachments),
  validate({ params: jobIdOnlyParams, query: threadQuery, body: sendMessageBody }),
  messages.sendMessage
);

export default router;
