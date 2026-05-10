import { Router } from "express";
import { signup, login, getMe } from "../controllers/authController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { ensureMongoConnected } from "../middleware/mongoReady.js";

const router = Router();

router.use(ensureMongoConnected);

router.post("/signup", signup);
router.post("/login", login);
router.get("/me", authMiddleware, getMe);

export default router;
