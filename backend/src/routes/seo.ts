import { Router } from "express";
import * as seo from "../controllers/seoController";
import { limiter } from "../middleware/rateLimit";

// Public, unauthenticated: nginx inlines /pros/:id/head into the profile page (SSI); crawlers read the sitemap.
const router = Router();

router.get("/pros/:userId/head", limiter("publicReads"), seo.proHead);
router.get("/sitemap-pros.xml", limiter("publicReads"), seo.proSitemap);

export default router;
