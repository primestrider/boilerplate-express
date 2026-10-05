import { sql } from "drizzle-orm";

import type { ModuleDependencies } from "../../routes";
import { HealthController } from "./health.controller";
import { createHealthRouter } from "./health.routes";
import { HealthService } from "./health.service";

/**
 * Wires the health module and returns its router.
 */
export const createHealthModule = ({ db }: ModuleDependencies) => {
  const service = new HealthService(() => {
    db.run(sql`select 1`);
  });
  const controller = new HealthController(service);

  return createHealthRouter(controller);
};
