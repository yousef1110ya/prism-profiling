import express from "express";
import { feed } from "../controllers/feed.controller.js";
import { reel_suggestions } from "../controllers/reel.controller.js";
import { explore } from "../controllers/explore.controller.js";
//import { suggest_users } from "../controllers/suggestions.controller.js";
const router = express.Router();

router.get("/feed", feed);
router.get("/reel", reel_suggestions);
router.get("/explore", explore);

export default router;
