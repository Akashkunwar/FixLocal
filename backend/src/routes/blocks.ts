import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { validate } from "../middleware/validate";
import { limiter } from "../middleware/rateLimit";
import { UserRole } from "../entities/User";
import * as blocks from "../controllers/blockController";

const router = Router();
router.use(requireAuth, requireRole(UserRole.HOMEOWNER, UserRole.TRADESPERSON));

router.get("/", blocks.listBlocks);
router.post("/", limiter("blocks"), validate({ body: z.object({ userId: z.string().uuid() }).strict() }), blocks.blockUser);
router.delete("/:userId", validate({ params: z.object({ userId: z.string().uuid() }) }), blocks.unblockUser);

export default router;
