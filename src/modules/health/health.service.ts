import type { HealthRepository, RuntimeInfo } from "./health.repository";

export type HealthStatus = RuntimeInfo & {
  status: "OK";
};

export class HealthService {
  constructor(private readonly healthRepository: HealthRepository) {}

  check(): HealthStatus {
    return {
      status: "OK",
      ...this.healthRepository.getRuntimeInfo(),
    };
  }
}
