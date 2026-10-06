import { HttpError } from "../../shared/errors/http-error";

export type LivenessStatus = {
  status: "OK";
  uptime: number;
  timestamp: string;
};

export type ReadinessStatus = LivenessStatus & {
  checks: Record<string, "up">;
};

/** Named dependency checks; each rejects when its dependency is down. */
export type HealthChecks = Record<string, () => Promise<unknown>>;

/**
 * Liveness answers "is the process running?"; readiness answers "can it serve
 * traffic?" by checking its dependencies.
 */
export class HealthService {
  constructor(private readonly checks: HealthChecks) {}

  liveness(): LivenessStatus {
    return {
      status: "OK",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<ReadinessStatus> {
    const names = Object.keys(this.checks);
    const results = await Promise.allSettled(
      Object.values(this.checks).map((check) => check()),
    );
    const down = names.filter((_, i) => results[i]?.status === "rejected");

    if (down.length > 0) {
      throw HttpError.serviceUnavailable(`Unavailable: ${down.join(", ")}`, {
        errorCode: "DEPENDENCY_UNAVAILABLE",
        details: Object.fromEntries(
          names.map((name) => [name, down.includes(name) ? "down" : "up"]),
        ),
      });
    }

    return {
      ...this.liveness(),
      checks: Object.fromEntries(names.map((name) => [name, "up" as const])),
    };
  }
}
