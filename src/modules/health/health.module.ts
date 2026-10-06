import { sql } from "drizzle-orm";
import type Redis from "ioredis";

import type { DB } from "../../db";
import { HealthController } from "./health.controller";
import { createHealthRouter } from "./health.routes";
import { HealthService, type HealthChecks } from "./health.service";

type HealthModuleDependencies = {
  db: DB;
  redis: Redis | undefined;
};

/**
 * Wires the health module. Redis is checked only when it is configured.
 */
export const createHealthModule = ({ db, redis }: HealthModuleDependencies) => {
  const checks: HealthChecks = {
    database: () => db.execute(sql`select 1`),
    ...(redis && { redis: () => redis.ping() }),
  };
  const controller = new HealthController(new HealthService(checks));

  return { router: createHealthRouter(controller) };
};
