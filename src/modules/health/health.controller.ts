import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";

import { sendSuccess } from "../../shared/http/response";
import type { HealthService } from "./health.service";

export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * GET /health/live
   */
  live: RequestHandler = (_req, res) => {
    sendSuccess(res, StatusCodes.OK, this.healthService.liveness());
  };

  /**
   * GET /health/ready
   */
  ready: RequestHandler = (_req, res) => {
    sendSuccess(res, StatusCodes.OK, this.healthService.readiness());
  };
}
