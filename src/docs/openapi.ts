import { z } from "zod";

import {
  auditLogResponseSchema,
  listAuditLogsQuerySchema,
} from "../modules/audit/audit.schema";
import {
  authenticationResponseSchema,
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
} from "../modules/authentication/authentication.schema";
import { ALLOWED_MIME_TYPES } from "../modules/files/file-type";
import {
  fileIdParamsSchema,
  fileResponseSchema,
  listFilesQuerySchema,
} from "../modules/files/file.schema";
import { userResponseSchema } from "../modules/users/user.mapper";
import {
  listUsersQuerySchema,
  updateUserRoleSchema,
  updateUserSchema,
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

const paginated = (description: string, item: string) =>
  success(
    description,
    { type: "array", items: ref(item) },
    ref("PaginationMeta"),
  );

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

const unauthorized = error("Missing, invalid or expired access token");

const healthStatus = {
  type: "object",
  required: ["status", "uptime", "timestamp"],
  properties: {
    status: { const: "OK" },
    uptime: { type: "number", description: "Process uptime in seconds" },
    timestamp: { type: "string", format: "date-time" },
  },
};

const idempotencyKeyHeader = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  description:
    "Unique key (1-255 chars of `A-Za-z0-9._:-`) that makes a retry return the first response instead of repeating the action. Replays carry `Idempotent-Replayed: true`.",
  schema: { type: "string", maxLength: 255 },
};

export const createOpenApiDocument = () => ({
  openapi: "3.1.0",
  info: {
    title: "boilerplate-express API",
    version: "1.0.0",
    license: { name: "ISC", identifier: "ISC" },
    description:
      "Every response body includes `statusCode`, equal to the HTTP status. Errors also carry a stable `errorCode`. Feature routes are versioned under `/v1`; health checks are not.",
  },
  servers: [{ url: "/api" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      User: jsonSchema(userResponseSchema, "output"),
      Authentication: jsonSchema(authenticationResponseSchema, "output"),
      File: jsonSchema(fileResponseSchema, "output"),
      AuditLog: jsonSchema(auditLogResponseSchema, "output"),
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
              "Validation issues (`[{ path, message }]`), the state of each dependency (readiness), or the stack trace outside production",
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
        summary: "Readiness: the database (and Redis, if configured) answer",
        security: publicAccess,
        responses: {
          200: success("Ready", {
            ...healthStatus,
            properties: {
              ...healthStatus.properties,
              checks: {
                type: "object",
                properties: {
                  database: { const: "up" },
                  redis: { const: "up" },
                },
              },
            },
          }),
          503: error(
            "A dependency is down (DEPENDENCY_UNAVAILABLE); `details` names it",
          ),
        },
      },
    },
    "/v1/authentication/register": {
      post: {
        tags: ["Authentication"],
        operationId: "register",
        summary: "Create an account (sends a welcome email)",
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
    "/v1/authentication/login": {
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
    "/v1/authentication/refresh": {
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
    "/v1/authentication/logout": {
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
    "/v1/authentication/change-password": {
      post: {
        tags: ["Authentication"],
        operationId: "changePassword",
        summary: "Change the caller's password",
        description:
          "Ends every session of the user (all refresh tokens are revoked) and sends a notification email.",
        security: bearer,
        requestBody: requestBody(changePasswordSchema),
        responses: {
          200: success("Password changed; log in again"),
          400: error(
            "Invalid body (VALIDATION_ERROR) or wrong current password (INVALID_CURRENT_PASSWORD)",
          ),
          401: unauthorized,
          429: error("Too many failed attempts (TOO_MANY_REQUESTS)"),
        },
      },
    },
    "/v1/authentication/profile": {
      get: {
        tags: ["Authentication"],
        operationId: "getProfile",
        summary: "Current user",
        security: bearer,
        responses: {
          200: success("Current user", ref("User")),
          401: unauthorized,
        },
      },
    },
    "/v1/users": {
      get: {
        tags: ["Users"],
        operationId: "listUsers",
        summary: "List, search, filter and sort users (admin only)",
        security: bearer,
        parameters: parameters(listUsersQuerySchema, "query"),
        responses: {
          200: paginated("Users", "User"),
          400: error("Invalid query (VALIDATION_ERROR)"),
          401: unauthorized,
          403: error("Not an admin (FORBIDDEN)"),
        },
      },
    },
    "/v1/users/{id}": {
      parameters: parameters(userIdParamsSchema, "path"),
      get: {
        tags: ["Users"],
        operationId: "getUser",
        summary: "Get a user (owner or admin)",
        security: bearer,
        responses: {
          200: success("The user", ref("User")),
          400: error("Invalid id (VALIDATION_ERROR)"),
          401: unauthorized,
          403: error("Not the owner and not an admin (FORBIDDEN)"),
          404: error("User not found (USER_NOT_FOUND)"),
        },
      },
      patch: {
        tags: ["Users"],
        operationId: "updateUser",
        summary: "Update name and/or email (owner or admin)",
        security: bearer,
        requestBody: requestBody(updateUserSchema),
        responses: {
          200: success("The updated user", ref("User")),
          400: error("Invalid id or body (VALIDATION_ERROR)"),
          401: unauthorized,
          403: error("Not the owner and not an admin (FORBIDDEN)"),
          404: error("User not found (USER_NOT_FOUND)"),
          409: error("Email already in use (EMAIL_ALREADY_EXISTS)"),
        },
      },
      delete: {
        tags: ["Users"],
        operationId: "deleteUser",
        summary: "Delete a user (owner or admin)",
        description:
          "Soft delete: the user can no longer log in or refresh, and the email stays reserved.",
        security: bearer,
        responses: {
          200: success("Deleted"),
          401: unauthorized,
          403: error("Not the owner and not an admin (FORBIDDEN)"),
          404: error("User not found (USER_NOT_FOUND)"),
        },
      },
    },
    "/v1/users/{id}/role": {
      patch: {
        tags: ["Users"],
        operationId: "changeUserRole",
        summary: "Change a user's role (admin only, not their own)",
        security: bearer,
        parameters: parameters(userIdParamsSchema, "path"),
        requestBody: requestBody(updateUserRoleSchema),
        responses: {
          200: success("The updated user", ref("User")),
          400: error(
            "Invalid body (VALIDATION_ERROR) or own role (CANNOT_CHANGE_OWN_ROLE)",
          ),
          401: unauthorized,
          403: error("Not an admin (FORBIDDEN)"),
          404: error("User not found (USER_NOT_FOUND)"),
        },
      },
    },
    "/v1/files": {
      get: {
        tags: ["Files"],
        operationId: "listFiles",
        summary: "The caller's files, newest first",
        security: bearer,
        parameters: parameters(listFilesQuerySchema, "query"),
        responses: {
          200: paginated("Files", "File"),
          401: unauthorized,
        },
      },
      post: {
        tags: ["Files"],
        operationId: "uploadFile",
        summary: "Upload a file",
        description: `The type is detected from the content. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}. Size limit: UPLOAD_MAX_BYTES.`,
        security: bearer,
        parameters: [idempotencyKeyHeader],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: { file: { type: "string", format: "binary" } },
              },
            },
          },
        },
        responses: {
          201: success("Uploaded", ref("File")),
          400: error("No file field (FILE_REQUIRED) or a bad Idempotency-Key"),
          401: unauthorized,
          409: error("Same Idempotency-Key still in progress"),
          413: error("File too large (FILE_TOO_LARGE)"),
          415: error("File type not allowed (UNSUPPORTED_FILE_TYPE)"),
          422: error("Idempotency-Key reused for another request"),
        },
      },
    },
    "/v1/files/{id}": {
      parameters: parameters(fileIdParamsSchema, "path"),
      get: {
        tags: ["Files"],
        operationId: "getFile",
        summary: "File metadata (owner or admin)",
        security: bearer,
        responses: {
          200: success("The file", ref("File")),
          401: unauthorized,
          404: error("Not found or not visible to the caller (FILE_NOT_FOUND)"),
        },
      },
      delete: {
        tags: ["Files"],
        operationId: "deleteFile",
        summary: "Delete a file (owner or admin)",
        security: bearer,
        responses: {
          200: success("Deleted"),
          401: unauthorized,
          404: error("Not found or not visible to the caller (FILE_NOT_FOUND)"),
        },
      },
    },
    "/v1/files/{id}/content": {
      get: {
        tags: ["Files"],
        operationId: "downloadFile",
        summary: "Download the file's bytes (owner or admin)",
        security: bearer,
        parameters: parameters(fileIdParamsSchema, "path"),
        responses: {
          200: {
            description: "The file, as an attachment",
            content: {
              "application/octet-stream": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          401: unauthorized,
          404: error("Not found or not visible to the caller (FILE_NOT_FOUND)"),
        },
      },
    },
    "/v1/audit-logs": {
      get: {
        tags: ["Audit"],
        operationId: "listAuditLogs",
        summary: "Security audit trail, newest first (admin only)",
        security: bearer,
        parameters: parameters(listAuditLogsQuerySchema, "query"),
        responses: {
          200: paginated("Audit log entries", "AuditLog"),
          400: error("Invalid query (VALIDATION_ERROR)"),
          401: unauthorized,
          403: error("Not an admin (FORBIDDEN)"),
        },
      },
    },
  },
});
