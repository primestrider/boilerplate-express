import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";

import { responseFormatter } from "../../libs/response";
import type { HealthService } from "./health.service";

export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  check: RequestHandler = (_req, res) => {
    const health = this.healthService.check();

    res
      .status(StatusCodes.OK)
      .json(responseFormatter.success(health, "Service is healthy"));
  };
}
