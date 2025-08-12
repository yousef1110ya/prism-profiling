import express from "express";
import authMiddleware from "../middleware/auth.js";
import {feed} from "../controllers/feed.controller.js";  
const router = express.Router(); 
router.use(authMiddleware); 

router.get('/feed', feed);

export default router ; 
