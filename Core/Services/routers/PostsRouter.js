import express from "express";
import authMiddleware from "../middleware/auth.js"; 
const router = express.Router(); 
router.use(authMiddleware); 

router.get('/feed', (req,res)=> {
  res.send("this is the feed page for you !!!"); 
});

export default router ; 
