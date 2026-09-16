import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth";
import { listMessages, sendMessage, streamMessages } from "../controllers/messageController";
import { uploadMessageAttachments } from "../middleware/upload";

const router = Router();

function handleMessageUpload(req: Request, res: Response, next: NextFunction) {
  uploadMessageAttachments(req, res, (err: any) => {
    if (err) {
      return res.status(400).json({ message: err.message || "Upload failed", code: "UPLOAD_ERROR" });
    }
    next();
  });
}

router.get("/:jobId/stream", requireAuth, streamMessages);
router.get("/:jobId", requireAuth, listMessages);
router.post("/:jobId", requireAuth, handleMessageUpload, sendMessage);

export default router;
