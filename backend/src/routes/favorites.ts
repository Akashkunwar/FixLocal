import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  listFavorites,
  addFavorite,
  removeFavorite,
  updateFavorite,
} from "../controllers/favoriteController";

const router = Router();

router.get("/", requireAuth, listFavorites);
router.post("/", requireAuth, addFavorite);
router.patch("/", requireAuth, updateFavorite);
router.delete("/", requireAuth, removeFavorite);

export default router;
