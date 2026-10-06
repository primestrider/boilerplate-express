# 18. Exercise: Build a New Module

## Goals

In this exercise you build a complete `products` feature yourself, using every pattern from the previous chapters:

- a new table and a migration ([chapter 6](06-database-mysql-drizzle.md));
- an entity, Zod schemas and a response mapper ([chapter 5](05-validation-and-error-handling.md));
- a repository, a service, a controller, routes and a module factory ([chapter 4](04-module-architecture.md));
- role-based access with `requireRole` ([chapter 8](08-authorization.md));
- audit log entries ([chapter 14](14-audit-log-and-request-context.md));
- OpenAPI documentation and integration tests ([chapter 16](16-testing.md)).

The finished module behaves like this:

| Method | Endpoint               | Who                | What                                                            |
| ------ | ---------------------- | ------------------ | --------------------------------------------------------------- |
| GET    | `/api/v1/products`     | Any signed-in user | List products: `page`, `limit`, `search`, `sortBy`, `sortOrder` |
| GET    | `/api/v1/products/:id` | Any signed-in user | Get one product                                                 |
| POST   | `/api/v1/products`     | Admin              | Create a product                                                |
| PATCH  | `/api/v1/products/:id` | Admin              | Change name, price and/or stock                                 |
| DELETE | `/api/v1/products/:id` | Admin              | Delete a product                                                |

A product has an `id`, a `name`, a `priceCents`, a `stock` and the usual `createdAt` / `updatedAt`.

> All the code below was compiled, linted and tested against this repository. Type it in yourself rather than copy-pasting everything: writing it is how the patterns stick. Compare with the `users` and `files` modules whenever you are unsure.

## Core concepts

### Why `priceCents` and not `price`?

Computers store decimals like `0.1` approximately (`0.1 + 0.2 === 0.30000000000000004` in JavaScript). For money, those tiny errors add up. The usual solution is to store the **smallest unit as an integer**: 4.50 becomes `450` cents. You format it for display at the edge (in the frontend).

### The order of work

Build from the inside out, so each layer can use the one below it:

```
1. table (schema.ts) + migration
2. entity          (types)
3. schemas + mapper (what comes in, what goes out)
4. repository      (SQL)
5. service         (rules, audit)
6. controller      (HTTP in/out)
7. routes          (URL + middleware order)
8. module          (wiring)
9. routes.ts       (mount under /api/v1)
10. OpenAPI docs
11. tests
```

The files you create:

```
src/modules/products/
  product.entity.ts
  product.schema.ts
  product.mapper.ts
  product.repository.ts
  product.service.ts
  product.controller.ts
  product.routes.ts
  product.module.ts
  products.test.ts
```

And the existing files you edit: `src/db/schema.ts`, `src/modules/audit/audit.entity.ts`, `src/routes.ts`, `src/docs/openapi.ts`, `src/docs/docs.test.ts`, `src/test/create-test-app.ts`.

Before you start, create a branch so you can throw the exercise away later: `git switch -c exercise/products`.

## In this boilerplate (step by step)

### Step 1: the table and its migration

Open `src/db/schema.ts`. Add `int` to the import from `drizzle-orm/mysql-core`:

```ts
import {
  bigint,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  varchar,
} from "drizzle-orm/mysql-core";
```

Then add the table at the end of the file. It reuses the `id()` helper and the `timestamps` object already defined at the top:

```ts
/**
 * Products sold in the shop. Prices are whole cents, so no rounding errors.
 */
export const products = mysqlTable(
  "products",
  {
    id: id(),
    name: varchar("name", { length: 200 }).notNull(),
    priceCents: int("price_cents", { unsigned: true }).notNull(),
    stock: int("stock", { unsigned: true }).notNull().default(0),
    ...timestamps,
  },
  (table) => [index("products_name_idx").on(table.name)],
);
```

- `unsigned: true` lets MySQL itself refuse negative prices and stock, a second line of defence behind validation.
- The index on `name` helps sorting by name. (A `LIKE '%tea%'` search cannot use a normal index because of the leading `%`; for large catalogues you would add a full-text index.)

Generate and apply the migration (MySQL must be running):

```bash
npm run db:generate -- --name products
npm run db:migrate
```

Open the new `drizzle/0001_products.sql`. It should contain:

```sql
CREATE TABLE `products` (
	`id` varchar(36) NOT NULL,
	`name` varchar(200) NOT NULL,
	`price_cents` int unsigned NOT NULL,
	`stock` int unsigned NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `products_name_idx` ON `products` (`name`);
```

Always read generated SQL before committing it; it is what will run against production.

### Step 2: the entity — `src/modules/products/product.entity.ts`

```ts
import type { products } from "../../db/schema";

/**
 * A product as stored in the database.
 */
export type Product = typeof products.$inferSelect;

/**
 * Payload required to create a product.
 */
export type CreateProductInput = {
  name: string;
  priceCents: number;
  stock: number;
};

/**
 * Fields an admin can change. Omitted fields stay as they are.
 */
export type UpdateProductInput = {
  name?: string | undefined;
  priceCents?: number | undefined;
  stock?: number | undefined;
};

export const PRODUCT_SORT_FIELDS = ["createdAt", "name", "priceCents"] as const;
```

- `$inferSelect` derives the TypeScript type from the table, so they can never disagree.
- The update type writes `?: string | undefined` (not just `?: string`). The project enables `exactOptionalPropertyTypes`, under which "optional" and "may be `undefined`" are different things; Zod's inferred types for `.optional()` contain `| undefined`, so the input types must allow it.
- `PRODUCT_SORT_FIELDS` is an **allowlist**: clients may only sort by these columns, never by an arbitrary string.

### Step 3: schemas and mapper

`src/modules/products/product.schema.ts`:

```ts
import { z } from "zod";

import { paginationQuerySchema } from "../../shared/http/pagination";
import { PRODUCT_SORT_FIELDS } from "./product.entity";

const name = z.string().trim().min(1).max(200);
/** Whole cents; the upper bound keeps values far below MySQL's INT limit. */
const priceCents = z.int().min(0).max(100_000_000);
const stock = z.int().min(0).max(1_000_000);

/**
 * Validation schema for listing products.
 */
export const listProductsQuerySchema = paginationQuerySchema.extend({
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Matches the product name"),
  sortBy: z.enum(PRODUCT_SORT_FIELDS).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const productIdParamsSchema = z.object({
  id: z.uuid(),
});

/**
 * Body of POST /products.
 */
export const createProductSchema = z.object({
  name,
  priceCents,
  stock: stock.default(0),
});

/**
 * Body of PATCH /products/:id. Every field is optional (no defaults, so a
 * missing field is never reset), but at least one is required.
 */
export const updateProductSchema = z
  .object({
    name: name.optional(),
    priceCents: priceCents.optional(),
    stock: stock.optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.priceCents !== undefined ||
      body.stock !== undefined,
    { message: "Provide at least one field to update" },
  );

export type ListProductsQueryDto = z.infer<typeof listProductsQuerySchema>;
export type ProductIdParamsDto = z.infer<typeof productIdParamsSchema>;
export type CreateProductDto = z.infer<typeof createProductSchema>;
export type UpdateProductDto = z.infer<typeof updateProductSchema>;
```

Points worth noticing:

- `paginationQuerySchema.extend(...)` reuses `page` and `limit` (with their defaults and the 1–100 limit) from `src/shared/http/pagination.ts`.
- `z.int()` rejects `4.5`; prices must be whole cents.
- Why not write `updateProductSchema = createProductSchema.partial()`? Because `createProductSchema` gives `stock` a **default** of `0`. A PATCH that only sends `{ "priceCents": 500 }` must not reset the stock to 0, so the update schema is written out without defaults. This is a subtle and common bug.
- The `.refine` makes `{}` a 400 instead of a pointless update.

`src/modules/products/product.mapper.ts`:

```ts
import { z } from "zod";

import type { Product } from "./product.entity";

/**
 * Public shape of a product, used by the mapper and the OpenAPI document.
 */
export const productResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  priceCents: z.int(),
  stock: z.int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type ProductResponse = z.infer<typeof productResponseSchema>;

export const toProductResponse = (product: Product): ProductResponse => ({
  id: product.id,
  name: product.name,
  priceCents: product.priceCents,
  stock: product.stock,
  createdAt: product.createdAt.toISOString(),
  updatedAt: product.updatedAt.toISOString(),
});
```

The schema documents the response in OpenAPI (step 10), and the mapper is typed against it, exactly like `src/modules/users/user.mapper.ts`.

### Step 4: the repository — `src/modules/products/product.repository.ts`

```ts
import { asc, desc, eq, like } from "drizzle-orm";

import type { DB } from "../../db";
import { affectedRows } from "../../db/errors";
import { products } from "../../db/schema";
import { offsetOf } from "../../shared/http/pagination";
import type {
  CreateProductInput,
  Product,
  UpdateProductInput,
} from "./product.entity";
import type { ListProductsQueryDto } from "./product.schema";

/** Escapes LIKE wildcards so a search for "50%" matches literally. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const SORT_COLUMNS = {
  createdAt: products.createdAt,
  name: products.name,
  priceCents: products.priceCents,
} as const;

export interface ProductRepository {
  findAll(
    query: ListProductsQueryDto,
  ): Promise<{ products: Product[]; total: number }>;
  findById(id: string): Promise<Product | null>;
  create(input: CreateProductInput): Promise<Product>;
  /** Returns the updated product, or null when it does not exist. */
  update(id: string, input: UpdateProductInput): Promise<Product | null>;
  /** Returns false when the product does not exist. */
  delete(id: string): Promise<boolean>;
}

export class DrizzleProductRepository implements ProductRepository {
  constructor(private readonly db: DB) {}

  /**
   * Returns a page of products, optionally filtered by name and sorted.
   */
  async findAll(query: ListProductsQueryDto) {
    const where = query.search
      ? like(products.name, `%${escapeLike(query.search)}%`)
      : undefined;
    const column = SORT_COLUMNS[query.sortBy];
    const direction = query.sortOrder === "asc" ? asc : desc;

    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(products)
        .where(where)
        // The id tiebreaker keeps pages stable when sort values are equal.
        .orderBy(direction(column), direction(products.id))
        .limit(query.limit)
        .offset(offsetOf(query)),
      this.db.$count(products, where),
    ]);

    return { products: rows, total };
  }

  async findById(id: string): Promise<Product | null> {
    const [product] = await this.db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    return product ?? null;
  }

  async create(input: CreateProductInput): Promise<Product> {
    const [inserted] = await this.db
      .insert(products)
      .values(input)
      .$returningId();

    // MySQL has no RETURNING; read the row back for its defaults.
    const product = inserted && (await this.findById(inserted.id));

    if (!product) {
      throw new Error("Failed to create product");
    }

    return product;
  }

  async update(id: string, input: UpdateProductInput): Promise<Product | null> {
    await this.db
      .update(products)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.priceCents !== undefined && { priceCents: input.priceCents }),
        ...(input.stock !== undefined && { stock: input.stock }),
      })
      .where(eq(products.id, id));

    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.delete(products).where(eq(products.id, id));

    return affectedRows(result) > 0;
  }
}
```

Compare it with `src/modules/users/user.repository.ts`; it is the same recipe:

- The **interface** is what the service depends on; the Drizzle class is one implementation.
- `escapeLike` stops `%` and `_` in the search term from acting as wildcards. It is copied from the users repository; if a third module needs it, move it to a shared helper.
- `SORT_COLUMNS[query.sortBy]` maps the validated sort name to a real column. User input never becomes SQL text.
- The list query and the `$count` share the same `where`, and run in parallel with `Promise.all`.
- `$returningId()` + `findById` is the MySQL way to get the inserted row back.
- `update` only sets fields that were sent. `affectedRows` tells `delete` whether a row existed.
- Products are **hard**-deleted (the row is removed). Users are soft-deleted because other data and the audit history refer to them; nothing references products yet. If orders ever reference products, switch to soft delete like `users`.

### Step 5: the service — `src/modules/products/product.service.ts`

First register the new audit actions in `src/modules/audit/audit.entity.ts`, at the end of `AUDIT_ACTIONS`:

```ts
  "file.deleted",
  "product.created",
  "product.updated",
  "product.deleted",
] as const;
```

Without this, TypeScript rejects `action: "product.created"`, and the audit list endpoint would not accept it as a filter.

Then the service:

```ts
import { HttpError } from "../../shared/errors/http-error";
import { paginate, type Paginated } from "../../shared/http/pagination";
import type { AuditService } from "../audit/audit.service";
import type {
  CreateProductInput,
  Product,
  UpdateProductInput,
} from "./product.entity";
import type { ProductRepository } from "./product.repository";
import type { ListProductsQueryDto } from "./product.schema";

const productNotFound = () =>
  HttpError.notFound("Product not found", { errorCode: "PRODUCT_NOT_FOUND" });

/**
 * Product business rules. Who may call what is decided by the routes
 * (admins write, any signed-in user reads).
 */
export class ProductService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: ListProductsQueryDto): Promise<Paginated<Product>> {
    const { products, total } = await this.repository.findAll(query);
    return paginate(products, total, query);
  }

  async findById(id: string): Promise<Product> {
    const product = await this.repository.findById(id);

    if (!product) throw productNotFound();

    return product;
  }

  async create(input: CreateProductInput): Promise<Product> {
    const product = await this.repository.create(input);

    await this.auditService.record({
      action: "product.created",
      entityType: "product",
      entityId: product.id,
      metadata: { name: product.name, priceCents: product.priceCents },
    });

    return product;
  }

  async update(id: string, input: UpdateProductInput): Promise<Product> {
    const product = await this.repository.update(id, input);

    if (!product) throw productNotFound();

    await this.auditService.record({
      action: "product.updated",
      entityType: "product",
      entityId: id,
      metadata: { fields: Object.keys(input) },
    });

    return product;
  }

  async delete(id: string): Promise<void> {
    if (!(await this.repository.delete(id))) throw productNotFound();

    await this.auditService.record({
      action: "product.deleted",
      entityType: "product",
      entityId: id,
    });
  }
}
```

- A missing product becomes a 404 with a stable `errorCode` that clients can check.
- `paginate` builds the `meta` object (`page`, `limit`, `total`, `totalPages`).
- The audit service fills in the actor, IP and request id from the request context; the service only says **what** happened.

### Step 6: the controller — `src/modules/products/product.controller.ts`

```ts
import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";

import { sendPaginated, sendSuccess } from "../../shared/http/response";
import { toProductResponse } from "./product.mapper";
import type {
  CreateProductDto,
  ListProductsQueryDto,
  ProductIdParamsDto,
  UpdateProductDto,
} from "./product.schema";
import type { ProductService } from "./product.service";

type NoParams = Record<string, never>;

export class ProductController {
  constructor(private readonly productService: ProductService) {}

  /**
   * GET /products
   */
  findAll: RequestHandler<NoParams, unknown, unknown, ListProductsQueryDto> =
    async (req, res) => {
      const products = await this.productService.findAll(req.query);

      sendPaginated(
        res,
        StatusCodes.OK,
        products.data.map(toProductResponse),
        products.meta,
        "Products retrieved successfully",
      );
    };

  /**
   * GET /products/:id
   */
  findById: RequestHandler<ProductIdParamsDto> = async (req, res) => {
    const product = await this.productService.findById(req.params.id);

    sendSuccess(res, StatusCodes.OK, toProductResponse(product));
  };

  /**
   * POST /products (admin)
   */
  create: RequestHandler<NoParams, unknown, CreateProductDto> = async (
    req,
    res,
  ) => {
    const product = await this.productService.create(req.body);

    sendSuccess(
      res,
      StatusCodes.CREATED,
      toProductResponse(product),
      "Product created successfully",
    );
  };

  /**
   * PATCH /products/:id (admin)
   */
  update: RequestHandler<ProductIdParamsDto, unknown, UpdateProductDto> =
    async (req, res) => {
      const product = await this.productService.update(req.params.id, req.body);

      sendSuccess(
        res,
        StatusCodes.OK,
        toProductResponse(product),
        "Product updated successfully",
      );
    };

  /**
   * DELETE /products/:id (admin)
   */
  delete: RequestHandler<ProductIdParamsDto> = async (req, res) => {
    await this.productService.delete(req.params.id);

    sendSuccess(res, StatusCodes.OK, undefined, "Product deleted successfully");
  };
}
```

- Handlers are **arrow-function properties**, so `this` still works when Express calls them as plain functions.
- The generic parameters of `RequestHandler<Params, ResBody, ReqBody, Query>` give `req.params`, `req.body` and `req.query` the types produced by the Zod schemas.
- There is no `try/catch`: Express 5 forwards rejected promises to the error middleware.

### Step 7: the routes — `src/modules/products/product.routes.ts`

```ts
import { Router, type RequestHandler } from "express";

import { validate } from "../../shared/middlewares/validate.middleware";
import { requireRole } from "../authentication/authorize";
import type { ProductController } from "./product.controller";
import {
  createProductSchema,
  listProductsQuerySchema,
  productIdParamsSchema,
  updateProductSchema,
} from "./product.schema";

/**
 * Every route requires a signed-in user; only admins can create, change or
 * delete products.
 */
export const createProductRouter = (
  productController: ProductController,
  authenticate: RequestHandler,
) => {
  const router = Router();

  router.use(authenticate);

  router.get(
    "/",
    validate({ query: listProductsQuerySchema }),
    productController.findAll,
  );
  router.get(
    "/:id",
    validate({ params: productIdParamsSchema }),
    productController.findById,
  );
  router.post(
    "/",
    requireRole("admin"),
    validate({ body: createProductSchema }),
    productController.create,
  );
  router.patch(
    "/:id",
    requireRole("admin"),
    validate({ params: productIdParamsSchema, body: updateProductSchema }),
    productController.update,
  );
  router.delete(
    "/:id",
    requireRole("admin"),
    validate({ params: productIdParamsSchema }),
    productController.delete,
  );

  return router;
};
```

The order inside each route matters: **authenticate → authorize → validate → handler**. A regular user gets 403 before their body is even looked at, and an anonymous caller gets 401 first.

### Step 8: the module — `src/modules/products/product.module.ts`

```ts
import type { RequestHandler } from "express";

import type { DB } from "../../db";
import type { AuditService } from "../audit/audit.service";
import { ProductController } from "./product.controller";
import { DrizzleProductRepository } from "./product.repository";
import { createProductRouter } from "./product.routes";
import { ProductService } from "./product.service";

type ProductModuleDependencies = {
  db: DB;
  authenticate: RequestHandler;
  auditService: AuditService;
};

/**
 * Wires the product module: repository → service → controller → router.
 */
export const createProductModule = ({
  db,
  authenticate,
  auditService,
}: ProductModuleDependencies) => {
  const service = new ProductService(
    new DrizzleProductRepository(db),
    auditService,
  );
  const controller = new ProductController(service);

  return { router: createProductRouter(controller, authenticate), service };
};
```

The module **declares** exactly what it needs; it does not reach for globals. The `service` is returned so a future `orders` module could use it.

### Step 9: mount it — `src/routes.ts`

Import the factory next to the other modules:

```ts
import { createProductModule } from "./modules/products/product.module";
```

Build it after the audit module exists, and mount it on the `v1` router:

```ts
const products = createProductModule({
  db,
  authenticate,
  auditService: audit.service,
});

const v1 = Router();
v1.use("/authentication", authentication.router);
v1.use("/users", users.router);
v1.use("/files", files.router);
v1.use("/audit-logs", audit.router);
v1.use("/products", products.router);
```

Restart `npm run dev`: the endpoints now exist.

### Step 10: document it — `src/docs/openapi.ts`

Add the imports:

```ts
import { productResponseSchema } from "../modules/products/product.mapper";
import {
  createProductSchema,
  listProductsQuerySchema,
  productIdParamsSchema,
  updateProductSchema,
} from "../modules/products/product.schema";
```

Register the response schema under `components.schemas`, next to `AuditLog`:

```ts
      Product: jsonSchema(productResponseSchema, "output"),
```

Add the paths at the end of `paths`, using the helpers already defined in the file (`success`, `paginated`, `error`, `parameters`, `requestBody`, `ref`, `bearer`, `unauthorized`):

```ts
    "/v1/products": {
      get: {
        tags: ["Products"],
        operationId: "listProducts",
        summary: "List, search and sort products",
        security: bearer,
        parameters: parameters(listProductsQuerySchema, "query"),
        responses: {
          200: paginated("Products", "Product"),
          400: error("Invalid query (VALIDATION_ERROR)"),
          401: unauthorized,
        },
      },
      post: {
        tags: ["Products"],
        operationId: "createProduct",
        summary: "Create a product (admin only)",
        security: bearer,
        requestBody: requestBody(createProductSchema),
        responses: {
          201: success("The new product", ref("Product")),
          400: error("Invalid body (VALIDATION_ERROR)"),
          401: unauthorized,
          403: error("Not an admin (FORBIDDEN)"),
        },
      },
    },
    "/v1/products/{id}": {
      parameters: parameters(productIdParamsSchema, "path"),
      get: {
        tags: ["Products"],
        operationId: "getProduct",
        summary: "Get a product",
        security: bearer,
        responses: {
          200: success("The product", ref("Product")),
          401: unauthorized,
          404: error("Product not found (PRODUCT_NOT_FOUND)"),
        },
      },
      patch: {
        tags: ["Products"],
        operationId: "updateProduct",
        summary: "Update a product (admin only)",
        security: bearer,
        requestBody: requestBody(updateProductSchema),
        responses: {
          200: success("The updated product", ref("Product")),
          400: error("Invalid body (VALIDATION_ERROR)"),
          401: unauthorized,
          403: error("Not an admin (FORBIDDEN)"),
          404: error("Product not found (PRODUCT_NOT_FOUND)"),
        },
      },
      delete: {
        tags: ["Products"],
        operationId: "deleteProduct",
        summary: "Delete a product (admin only)",
        security: bearer,
        responses: {
          200: success("Deleted"),
          401: unauthorized,
          403: error("Not an admin (FORBIDDEN)"),
          404: error("Product not found (PRODUCT_NOT_FOUND)"),
        },
      },
    },
```

`src/docs/docs.test.ts` checks the exact list of documented paths, so add the two new ones there, in sorted position (after `"/v1/files/{id}/content"`):

```ts
      "/v1/products",
      "/v1/products/{id}",
```

Open http://localhost:3000/api/docs: a "Products" section appears, with request bodies and parameters generated from your Zod schemas.

### Step 11: tests

First, `createTestApp()` empties every table before each test. Teach it about the new table in `src/test/create-test-app.ts`:

```ts
import { auditLogs, files, products, refreshTokens, users } from "../db/schema";
```

```ts
// Children before parents (foreign keys).
for (const table of [files, refreshTokens, auditLogs, products, users]) {
  await db.delete(table);
}
```

Then create `src/modules/products/products.test.ts`:

```ts
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createTestApp,
  registerAdmin,
  registerUser,
  type TestApp,
} from "../../test/create-test-app";

describe("products", () => {
  let app: TestApp;
  let adminToken: string;
  let userToken: string;

  beforeEach(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    userToken = (await registerUser(app)).accessToken;
    adminToken = (await registerAdmin(app, testApp.db)).accessToken;
  });

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  const createProduct = (body: object, token = adminToken) =>
    request(app).post("/api/v1/products").set(as(token)).send(body);

  it("lets an admin create a product that any user can read", async () => {
    const created = await createProduct({ name: "Coffee", priceCents: 450 });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      name: "Coffee",
      priceCents: 450,
      stock: 0,
    });

    const read = await request(app)
      .get(`/api/v1/products/${created.body.data.id}`)
      .set(as(userToken));

    expect(read.status).toBe(200);
    expect(read.body.data.name).toBe("Coffee");
  });

  it("does not let regular users create products", async () => {
    const res = await createProduct(
      { name: "Tea", priceCents: 300 },
      userToken,
    );

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe("FORBIDDEN");
  });

  it("validates the body", async () => {
    const res = await createProduct({ name: "", priceCents: 1.5 });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("VALIDATION_ERROR");
    expect(res.body.details.map((d: { path: string }) => d.path)).toEqual([
      "name",
      "priceCents",
    ]);
  });

  it("searches and sorts", async () => {
    await createProduct({ name: "Green tea", priceCents: 300 });
    await createProduct({ name: "Black tea", priceCents: 200 });
    await createProduct({ name: "Coffee", priceCents: 450 });

    const res = await request(app)
      .get("/api/v1/products?search=tea&sortBy=priceCents&sortOrder=asc")
      .set(as(userToken));

    expect(res.body.data.map((p: { name: string }) => p.name)).toEqual([
      "Black tea",
      "Green tea",
    ]);
    expect(res.body.meta.total).toBe(2);
  });

  it("updates only the fields sent", async () => {
    const { id } = (
      await createProduct({ name: "Coffee", priceCents: 450, stock: 7 })
    ).body.data;

    const res = await request(app)
      .patch(`/api/v1/products/${id}`)
      .set(as(adminToken))
      .send({ priceCents: 500 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: "Coffee",
      priceCents: 500,
      stock: 7,
    });
  });

  it("deletes, then answers 404", async () => {
    const { id } = (await createProduct({ name: "Coffee", priceCents: 450 }))
      .body.data;

    const removed = await request(app)
      .delete(`/api/v1/products/${id}`)
      .set(as(adminToken));
    const again = await request(app)
      .get(`/api/v1/products/${id}`)
      .set(as(userToken));

    expect(removed.status).toBe(200);
    expect(again.status).toBe(404);
    expect(again.body.errorCode).toBe("PRODUCT_NOT_FOUND");
  });

  it("records changes in the audit log", async () => {
    await createProduct({ name: "Coffee", priceCents: 450 });

    const res = await request(app)
      .get("/api/v1/audit-logs?action=product.created")
      .set(as(adminToken));

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].metadata).toEqual({
      name: "Coffee",
      priceCents: 450,
    });
  });
});
```

The "updates only the fields sent" test is the one that would catch the `.partial()`-with-defaults bug from step 3. Try it: change `updateProductSchema` to `createProductSchema.partial()` and watch that test fail.

## Step by step: verify everything

Run the same checks as CI:

```bash
npm run format        # format your new files
npm run lint
npm run typecheck
npm test              # MySQL must be running
```

All must be green before you consider the module done.

## Try it yourself

Start `npm run dev`, then in Git Bash:

```bash
# A regular user
USER_TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/authentication/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Shopper","email":"shopper@x.com","password":"correct horse battery"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')

# An admin: register, promote with the CLI, then log in again for a token with the new role
curl -s -X POST http://localhost:3000/api/v1/authentication/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Boss","email":"boss@x.com","password":"correct horse battery"}' > /dev/null
npm run user:make-admin -- boss@x.com
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/authentication/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"boss@x.com","password":"correct horse battery"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')

# Admin creates a product
curl -s -X POST http://localhost:3000/api/v1/products \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Coffee","priceCents":450,"stock":10}'
# {"statusCode":201,"message":"Product created successfully","data":{"id":"...","name":"Coffee","priceCents":450,"stock":10,...}}

# The regular user can read but not create
curl -s "http://localhost:3000/api/v1/products?search=cof" -H "Authorization: Bearer $USER_TOKEN"
curl -s -X POST http://localhost:3000/api/v1/products \
  -H "Authorization: Bearer $USER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Tea","priceCents":300}'
# {"statusCode":403,"message":"You do not have permission to perform this action","errorCode":"FORBIDDEN"}

# Validation
curl -s -X POST http://localhost:3000/api/v1/products \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Tea","priceCents":-5}'
# {"statusCode":400,"message":"Validation error","errorCode":"VALIDATION_ERROR","details":[{"path":"priceCents",...}]}
```

(If `shopper@x.com` or `boss@x.com` already exist from an earlier run, use other emails.)

## Common mistakes

- **Forgetting the migration** (or editing the schema without `db:generate`): the app starts, then every product query fails with "Table doesn't exist".
- **Forgetting `AUDIT_ACTIONS`**: a type error in the service.
- **Forgetting `create-test-app.ts`**: products from one test leak into the next and counts become flaky.
- **Forgetting `docs.test.ts`**: the docs test fails because the path list changed. That failure is intentional; it forces documentation to stay complete.
- **`requireRole` after `validate`**: non-admins would receive validation details for an action they may not perform. Authorize first.
- **Sorting by a raw query string**: always map through an allowlist like `SORT_COLUMNS`.
- **Using floats for money.**
- **`.partial()` on a schema with defaults** for PATCH bodies (step 3).

## Extra challenges

Try these once the module works. Only hints are given; look at the existing modules for the patterns.

1. **Idempotent create.** Make `POST /api/v1/products` safe to retry with an `Idempotency-Key`.
   _Hints:_ `routes.ts` already builds `idempotency` with `createIdempotency(cache)`. Pass it into `createProductModule` like the files module does, and place it **after** `authenticate`, `requireRole` and `validate` (the body is part of the fingerprint) in the POST route. Add `idempotencyKeyHeader` to the OpenAPI operation. Test it the way `files.test.ts` does. See [chapter 11](11-idempotency.md).

2. **Cache product lookups.** Serve `GET /products/:id` from the cache.
   _Hints:_ write a `CachedProductRepository` decorator modelled on `src/modules/users/cached-user.repository.ts`: cache `findById`, evict on `update` and `delete`, revive the `Date` fields, and wrap cache calls so a Redis outage falls back to the database. Inject `cache` from `routes.ts`. See [chapter 10](10-redis-and-caching.md).

3. **"Low stock" email.** When an update brings `stock` below 5, email the admin team.
   _Hints:_ add a `MAIL_ADMIN` (or similar) variable to `src/config/env.ts` and `.env.example`; write a template like `src/modules/authentication/authentication.emails.ts`; inject `jobQueue` into the product module and queue a `"send-email"` job from `ProductService.update` only when the stock **crosses** the threshold (compare with the previous value, so every later update does not send another email). Make the notification best effort, like `notify()` in `AuthenticationService`. In tests, assert on `RecordingJobQueue.jobs`. See [chapter 12](12-background-jobs-and-email.md).

4. **Stock that cannot go negative under concurrency.** Add `POST /products/:id/reserve` with `{ quantity }` that decreases stock.
   _Hints:_ do it in **one** conditional SQL statement, `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`, and check `affectedRows`, like `revokeIfActive` in `src/modules/authentication/refresh-token.repository.ts`. Reading the stock first and writing it later lets two simultaneous requests both succeed. Use the `sql` template tag from `drizzle-orm` for the expression: `` sql`${products.stock} - ${quantity}` ``. Answer 409 when there is not enough stock. See [chapter 6](06-database-mysql-drizzle.md).

When you are done, throw the branch away (`git switch main && git branch -D exercise/products`), or keep it as your first real feature.

## Summary

- A feature module is built inside out: table and migration, entity, schemas and mapper, repository, service, controller, routes, module, wiring, docs, tests.
- Every layer has one job, and each pattern (allowlisted sorting, `$returningId`, `affectedRows`, `HttpError` with an `errorCode`, audit entries, `requireRole` before `validate`) is reused from existing modules.
- Shared tests (`docs.test.ts`) and helpers (`create-test-app.ts`) are part of adding a module.
- The extra challenges practise idempotency, caching, background jobs and race-free updates on your own code.

Next: [Glossary](glossary.md)
