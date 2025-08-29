import express from "express";
import * as CONTROLLER from "../controllers/search.controller.js";
const router = express.Router();

router.get("/user", CONTROLLER.user);
router.get("/group", CONTROLLER.group);
router.get("/post", CONTROLLER.post);
router.get("/hashtag", CONTROLLER.hashtag);
export default router;
