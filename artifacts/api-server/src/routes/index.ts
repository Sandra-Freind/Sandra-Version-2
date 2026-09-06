import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sandraRouter from "./sandra";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/sandra", sandraRouter);

export default router;
