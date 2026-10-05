import { sql } from "drizzle-orm";

import type { DB } from "../../db";
import { HealthController } from "./health.controller";
import { createHealthRouter } from "./health.routes";
import { HealthService } from "./health.service";

type HealthModuleDependencies = {
  db: DB;
};

/**
 * Wires the health module.
 */
export const createHealthModule = ({ db }: HealthModuleDependencies) => {
  const service = new HealthService(() => {
    db.run(sql`select 1`);
  });
  const controller = new HealthController(service);

  return { router: createHealthRouter(controller) };
};
