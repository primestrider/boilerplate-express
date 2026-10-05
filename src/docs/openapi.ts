import { z } from "zod";

import {
  authenticationResponseSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
} from "../modules/authentication/authentication.schema";
import { userResponseSchema } from "../modules/users/user.mapper";
import {
  listUsersQuerySchema,
  userIdParamsSchema,
} from "../modules/users/user.schema";

/**
 * OpenAPI 3.1 description of the API.
 *
 * Request and response bodies are generated from the same Zod schemas the
 * code validates and maps with, so they stay in sync. When adding a route,
 * add its path here.
 */

type JsonSchema = Record<string, unknown>;

/**
 * JSON Schema of a Zod schema. "input" describes what clients send (before
 * defaults/coercion), "output" what the API returns.
 */
const jsonSchema = (schema: z.ZodType, io: "input" | "output"): JsonSchema => {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io });
  return rest;
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const jsonContent = (schema: JsonSchema) => ({
  content: { "application/json": { schema } },
});

const requestBody = (schema: z.ZodType) => ({
  required: true,
  ...jsonContent(jsonSchema(schema, "input")),
});

/** Success envelope: `{ statusCode, message?, data?, meta? }`. */
const success = (
  description: string,
  data?: JsonSchema,
  meta?: JsonSchema,
) => ({
  description,
  ...jsonContent({
    type: "object",
    required: [
      "statusCode",
      ...(data ? ["data"] : []),
      ...(meta ? ["meta"] : []),
    ],
    properties: {
      statusCode: { type: "integer" },
      message: { type: "string" },
      ...(data ? { data } : {}),
      ...(meta ? { meta } : {}),
    },
  }),
});

const error = (description: string) => ({
  description,
  ...jsonContent(ref("Error")),
});

/** Parameters generated from a Zod object schema. */
const parameters = (schema: z.ZodObject, location: "query" | "path") =>
  Object.entries(schema.shape).map(([name, field]) => ({
    name,
    in: location,
    required: location === "path",
    schema: jsonSchema(field as z.ZodType, "output"),
  }));

const bearer = [{ bearerAuth: [] }];
const publicAccess: never[] = [];

const healthStatus = {
  type: "object",
  required: ["status", "uptime", "timestamp"],
  properties: {
    status: { const: "OK" },
    uptime: { type: "number", description: "Process uptime in seconds" },
    timestamp: { type: "string", format: "date-time" },
  },
};

export const createOpenApiDocument = () => ({
  openapi: "3.1.0",
  info: {
    title: "boilerplate-express API",
    version: "1.0.0",
    license: { name: "ISC", identifier: "ISC" },
    description:
      "Every response body includes `statusCode`, equal to the HTTP status. Errors also carry a stable `errorCode`.",
  },
  servers: [{ url: "/api" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      User: jsonSchema(userResponseSchema, "output"),
      Authentication: jsonSchema(authenticationResponseSchema, "output"),
      PaginationMeta: {
        type: "object",
        required: ["page", "limit", "total", "totalPages"],
        properties: {
          page: { type: "integer" },
          limit: { type: "integer" },
          total: { type: "integer" },
          totalPages: { type: "integer" },
        },
      },
      Error: {
        type: "object",
        required: ["statusCode", "message", "errorCode"],
        properties: {
          statusCode: { type: "integer" },
          message: { type: "string" },
          errorCode: { type: "string", examples: ["VALIDATION_ERROR"] },
          details: {
            description:
              "Validation issues (`[{ path, message }]`), or the stack trace outside production",
          },
        },
      },
    },
  },
  paths: {
    "/health/live": {
      get: {
        tags: ["Health"],
        operationId: "getLiveness",
        summary: "Liveness: the process is running",
        security: publicAccess,
        responses: { 200: success("Alive", healthStatus) },
      },
    },
    "/health/ready": {
      get: {
        tags: ["Health"],
        operationId: "getReadiness",
        summary: "Readiness: dependencies (database) are reachable",
        security: publicAccess,
        responses: {
          200: success("Ready", {
            ...healthStatus,
            properties: {
              ...healthStatus.properties,
              checks: {
                type: "object",
                properties: { database: { const: "up" } },
              },
            },
          }),
          503: error("Database unavailable (DATABASE_UNAVAILABLE)"),
        },
      },
    },
    "/authentication/register": {
      post: {
        tags: ["Authentication"],
        operationId: "register",
        summary: "Create an account",
        security: publicAccess,
        requestBody: requestBody(registerSchema),
        responses: {
          201: success("Registered", ref("Authentication")),
          400: error("Invalid body (VALIDATION_ERROR)"),
          409: error("Email already registered (EMAIL_ALREADY_EXISTS)"),
          429: error("Too many failed attempts (TOO_MANY_REQUESTS)"),
        },
      },
    },
    "/authentication/login": {
      post: {
        tags: ["Authentication"],
        operationId: "login",
        summary: "Exchange email and password for tokens",
        security: publicAccess,
        requestBody: requestBody(loginSchema),
        responses: {
          200: success("Logged in", ref("Authentication")),
          400: error("Invalid body (VALIDATION_ERROR)"),
          401: error("Wrong email or password (INVALID_CREDENTIALS)"),
          429: error("Too many failed attempts (TOO_MANY_REQUESTS)"),
        },
      },
    },
    "/authentication/refresh": {
      post: {
        tags: ["Authentication"],
        operationId: "refreshTokens",
        summary: "Rotate a refresh token into a new token pair",
        security: publicAccess,
        description:
          "Each refresh token works once. Reusing one revokes its whole session.",
        requestBody: requestBody(refreshSchema),
        responses: {
          200: success("New tokens", ref("Authentication")),
          401: error(
            "Unknown, expired or reused token (INVALID_REFRESH_TOKEN)",
          ),
          429: error("Too many failed attempts (TOO_MANY_REQUESTS)"),
        },
      },
    },
    "/authentication/logout": {
      post: {
        tags: ["Authentication"],
        operationId: "logout",
        summary: "End the session a refresh token belongs to",
        security: publicAccess,
        requestBody: requestBody(refreshSchema),
        responses: {
          200: success("Logged out (also for unknown tokens)"),
          400: error("Invalid body (VALIDATION_ERROR)"),
        },
      },
    },
    "/authentication/profile": {
      get: {
        tags: ["Authentication"],
        operationId: "getProfile",
        summary: "Current user",
        security: bearer,
        responses: {
          200: success("Current user", ref("User")),
          401: error("Missing, invalid or expired access token"),
        },
      },
    },
    "/users": {
      get: {
        tags: ["Users"],
        operationId: "listUsers",
        summary: "List users (admin only)",
        security: bearer,
        parameters: parameters(listUsersQuerySchema, "query"),
        responses: {
          200: success(
            "Users, newest first",
            { type: "array", items: ref("User") },
            ref("PaginationMeta"),
          ),
          400: error("Invalid query (VALIDATION_ERROR)"),
          401: error("Missing, invalid or expired access token"),
          403: error("Not an admin (FORBIDDEN)"),
        },
      },
    },
    "/users/{id}": {
      get: {
        tags: ["Users"],
        operationId: "getUser",
        summary: "Get a user (owner or admin)",
        security: bearer,
        parameters: parameters(userIdParamsSchema, "path"),
        responses: {
          200: success("The user", ref("User")),
          400: error("Invalid id (VALIDATION_ERROR)"),
          401: error("Missing, invalid or expired access token"),
          403: error("Not the owner and not an admin (FORBIDDEN)"),
          404: error("User not found (USER_NOT_FOUND)"),
        },
      },
    },
  },
});
