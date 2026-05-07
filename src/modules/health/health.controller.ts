import type { RequestHandler } from "express";

import { sendSuccess } from "../../libs/http-response";
import type { HealthService } from "./health.service";

export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  check: RequestHandler = (_req, res) => {
    const health = this.healthService.check();

    sendSuccess(res, health, "Service is healthy");
  };
}
