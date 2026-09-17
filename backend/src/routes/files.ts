import { Router } from "express";
import { serveFile } from "../controllers/fileController";

const router = Router();
router.get("/:name", serveFile);

export default router;
