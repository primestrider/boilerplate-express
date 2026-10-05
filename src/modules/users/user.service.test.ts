import { describe, expect, it } from "vitest";

import { HttpError } from "../../shared/errors/http-error";
import type { User } from "./user.entity";
import type { UserRepository } from "./user.repository";
import { UserService } from "./user.service";

/**
 * In-memory repository: the service only depends on the UserRepository
 * interface, so it can be tested without a database.
 */
const createFakeRepository = (seed: User[] = []): UserRepository => {
  const users = [...seed];

  return {
    findAll: async ({ page, limit }) => ({
      users: users.slice((page - 1) * limit, page * limit),
      total: users.length,
    }),
    findById: async (id) => users.find((u) => u.id === id) ?? null,
    findByEmail: async (email) => users.find((u) => u.email === email) ?? null,
    create: async (input) => {
      const user = {
        ...input,
        id: String(users.length + 1),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      users.push(user);
      return user;
    },
    updatePasswordHash: async () => {},
  };
};

const existing: User = {
  id: "1",
  name: "Ricky",
  email: "r@x.com",
  passwordHash: "hash",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("UserService", () => {
  it("throws a 409 when the email is taken", async () => {
    const service = new UserService(createFakeRepository([existing]));

    const error = await service
      .create({ name: "Other", email: "r@x.com", passwordHash: "hash" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      statusCode: 409,
      errorCode: "EMAIL_ALREADY_EXISTS",
    });
  });

  it("throws a 404 for an unknown id", async () => {
    const service = new UserService(createFakeRepository());

    await expect(service.findById("missing")).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "USER_NOT_FOUND",
    });
  });

  it("computes totalPages from the total count", async () => {
    const service = new UserService(
      createFakeRepository([existing, { ...existing, id: "2" }]),
    );

    const result = await service.findAll({ page: 1, limit: 1 });

    expect(result.meta).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });
});
