import { startConsumer } from "./services/rabbitmqConsumer.js";
import express from "express";
import authMiddleware from "./Services/middleware/auth.js";
import mainRouter from "./Services/routers/PostsRouter.js";
import search_router from "./Services/routers/search.router.js";
const app = express();
const PORT = 6000;
startConsumer().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

app.use(express.json());
app.use(authMiddleware);
app.use("/api", mainRouter);
app.use("/api/search", search_router);
app.listen(PORT, () => {
  console.log("the express server is now working on port 6000");
});
