import { Router, type IRouter } from "express";
import healthRouter from "./health";
import inventoryRouter from "./inventory";
import suggestionsRouter from "./suggestions";
import shoppingRouter from "./shopping";

const router: IRouter = Router();

router.use(healthRouter);
router.use(inventoryRouter);
router.use(suggestionsRouter);
router.use(shoppingRouter);

export default router;
