import { Router } from "express";

import type { HealthController } from "./health.controller";

export const createHealthRouter = (healthController: HealthController) => {
  const router = Router();

  router.get("/live", healthController.live);
  router.get("/ready", healthController.ready);

  return router;
};
