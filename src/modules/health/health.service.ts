import { HttpError } from "../../shared/errors/http-error";

export type LivenessStatus = {
  status: "OK";
  uptime: number;
  timestamp: string;
};

export type ReadinessStatus = LivenessStatus & {
  checks: { database: "up" };
};

/**
 * Liveness answers "is the process running?"; readiness answers "can it serve
 * traffic?" by checking its dependencies.
 */
export class HealthService {
  constructor(private readonly pingDatabase: () => void) {}

  liveness(): LivenessStatus {
    return {
      status: "OK",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  readiness(): ReadinessStatus {
    try {
      this.pingDatabase();
    } catch (error) {
      throw HttpError.serviceUnavailable("Database is unavailable", {
        errorCode: "DATABASE_UNAVAILABLE",
        details: error instanceof Error ? error.message : undefined,
      });
    }

    return { ...this.liveness(), checks: { database: "up" } };
  }
}
