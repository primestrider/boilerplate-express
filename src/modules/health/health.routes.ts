import { Router } from "express";

import { asyncHandler } from "../../middlewares/async-handler.middleware";
import type { HealthController } from "./health.controller";

export const createHealthRouter = (healthController: HealthController) => {
  const router = Router();

  router.get("/", asyncHandler(healthController.check));

  return router;
};
