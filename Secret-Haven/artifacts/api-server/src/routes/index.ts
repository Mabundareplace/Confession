import { Router, type IRouter } from "express";
import adminRouter from "./admin";
import healthRouter from "./health";
import userRouter from "./user";

const router: IRouter = Router();

router.use(healthRouter);
router.use(userRouter);
router.use("/admin", adminRouter);

export default router;
