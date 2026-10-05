import { Router } from "express";
import swaggerUi from "swagger-ui-express";

import { createOpenApiDocument } from "./openapi";

/**
 * Serves the OpenAPI document and Swagger UI:
 *   GET /docs               interactive UI
 *   GET /docs/openapi.json  raw document (for code generators, Postman, ...)
 */
export const createDocsRouter = () => {
  const document = createOpenApiDocument();
  const router = Router();

  // The raw spec is not wrapped in the API envelope; tools expect it as is.
  router.get("/openapi.json", (_req, res) => {
    res.json(document);
  });
  router.use("/", swaggerUi.serve, swaggerUi.setup(document));

  return router;
};
