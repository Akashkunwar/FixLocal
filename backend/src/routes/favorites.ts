import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import * as f from "../controllers/favoriteController";
import * as s from "../validation/misc";

const router = Router();
router.use(requireAuth);

router.get("/", validate({ query: s.listFavoritesQuery }), f.listFavorites);
router.post("/", validate({ body: s.addFavoriteBody }), f.addFavorite);
router.patch("/", validate({ body: s.updateFavoriteBody }), f.updateFavorite);
router.delete("/", validate({ query: s.favoriteQuery }), f.removeFavorite);

export default router;
