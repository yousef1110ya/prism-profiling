import express from "express";
import authMiddleware from "../middleware/auth.js";
import { feed } from "../controllers/feed.controller.js";
import { reel_suggestions } from "../controllers/reel.controller.js";
const router = express.Router();
router.use(authMiddleware);

router.get("/feed", feed);
router.get("/reel", reel_suggestions);

export default router;
