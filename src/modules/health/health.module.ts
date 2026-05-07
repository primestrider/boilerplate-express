import { HealthController } from "./health.controller";
import { SystemHealthRepository } from "./health.repository";
import { createHealthRouter } from "./health.routes";
import { HealthService } from "./health.service";

/**
 * Creates the health module with all of its dependencies.
 *
 * Keeping this composition inside the module prevents the app-level router from
 * growing as more modules are added.
 */
export const createHealthModule = () => {
  const repository = new SystemHealthRepository();
  const service = new HealthService(repository);
  const controller = new HealthController(service);
  const router = createHealthRouter(controller);

  return {
    controller,
    repository,
    router,
    service,
  };
};
