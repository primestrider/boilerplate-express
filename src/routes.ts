import { Router } from "express";

import { createHealthModule } from "./modules/health/health.module";
import { createUserModule } from "./modules/users/user.module";

const routes = Router();

const healthModule = createHealthModule();
const userModule = createUserModule();

routes.use("/health", healthModule.router);
routes.use("/users", userModule.router);

export default routes;
