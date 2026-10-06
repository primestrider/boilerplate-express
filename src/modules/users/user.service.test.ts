import { describe, expect, it } from "vitest";

import { HttpError } from "../../shared/errors/http-error";
import type { NewAuditLog } from "../audit/audit.entity";
import { AuditService } from "../audit/audit.service";
import type { User } from "./user.entity";
import type { UserRepository } from "./user.repository";
import { UserService } from "./user.service";

/**
 * In-memory repository: the service only depends on the UserRepository
 * interface, so it can be tested without a database.
 */
const createFakeRepository = (seed: User[] = []): UserRepository => {
  const users = seed.map((user) => ({ ...user }));
  const live = () => users.filter((u) => u.deletedAt === null);
  const find = (id: string) => live().find((u) => u.id === id) ?? null;

  return {
    findAll: async ({ page, limit }) => ({
      users: live().slice((page - 1) * limit, page * limit),
      total: live().length,
    }),
    findById: async (id) => find(id),
    findByEmail: async (email) => live().find((u) => u.email === email) ?? null,
    isEmailTaken: async (email, exceptUserId) =>
      users.some((u) => u.email === email && u.id !== exceptUserId),
    create: async (input) => {
      const user: User = {
        ...input,
        id: String(users.length + 1),
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      users.push(user);
      return user;
    },
    update: async (id, input) => {
      const user = find(id);
      if (user) Object.assign(user, input);
      return user;
    },
    updatePasswordHash: async () => {},
    updateRole: async (id, role) => {
      const user = find(id);
      if (user) user.role = role;
    },
    softDelete: async (id) => {
      const user = find(id);
      if (user) user.deletedAt = new Date();
      return user !== null;
    },
  };
};

const createService = (seed: User[] = []) => {
  const audit: NewAuditLog[] = [];
  const auditService = new AuditService({
    create: async (entry) => {
      audit.push(entry);
    },
    findAll: async () => ({ logs: [], total: 0 }),
  });

  return {
    service: new UserService(createFakeRepository(seed), auditService),
    audit,
  };
};

const existing: User = {
  id: "1",
  name: "Ricky",
  email: "r@x.com",
  passwordHash: "hash",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

describe("UserService", () => {
  it("throws a 409 when the email is taken", async () => {
    const { service } = createService([existing]);

    const error = await service
      .create({ name: "Other", email: "r@x.com", passwordHash: "hash" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      statusCode: 409,
      errorCode: "EMAIL_ALREADY_EXISTS",
    });
  });

  it("keeps a deleted user's email reserved", async () => {
    const { service } = createService([{ ...existing, deletedAt: new Date() }]);

    await expect(
      service.create({ name: "New", email: "r@x.com", passwordHash: "hash" }),
    ).rejects.toMatchObject({ errorCode: "EMAIL_ALREADY_EXISTS" });
  });

  it("throws a 404 for an unknown id", async () => {
    const { service } = createService();

    await expect(service.findById("missing")).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "USER_NOT_FOUND",
    });
  });

  it("computes totalPages from the total count", async () => {
    const { service } = createService([existing, { ...existing, id: "2" }]);

    const result = await service.findAll({ page: 1, limit: 1 });

    expect(result.meta).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });

  describe("update", () => {
    it("rejects an email that belongs to another user", async () => {
      const { service } = createService([
        existing,
        { ...existing, id: "2", email: "other@x.com" },
      ]);

      await expect(
        service.update("1", { email: "other@x.com" }),
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it("allows keeping the own email and records the change", async () => {
      const { service, audit } = createService([existing]);

      const user = await service.update("1", { name: "New", email: "r@x.com" });

      expect(user.name).toBe("New");
      expect(audit).toEqual([
        expect.objectContaining({
          action: "user.updated",
          entityId: "1",
          metadata: { fields: ["name", "email"] },
        }),
      ]);
    });
  });

  describe("changeRole", () => {
    it("refuses to change the caller's own role", async () => {
      const { service } = createService([existing]);

      await expect(service.changeRole("1", "1", "admin")).rejects.toMatchObject(
        {
          statusCode: 400,
          errorCode: "CANNOT_CHANGE_OWN_ROLE",
        },
      );
    });

    it("records the old and new role", async () => {
      const { service, audit } = createService([existing]);

      const user = await service.changeRole("admin-id", "1", "admin");

      expect(user.role).toBe("admin");
      expect(audit[0]).toMatchObject({
        action: "user.role_changed",
        metadata: { from: "user", to: "admin" },
      });
    });

    it("does nothing when the role is unchanged", async () => {
      const { service, audit } = createService([existing]);

      await service.changeRole("admin-id", "1", "user");

      expect(audit).toEqual([]);
    });
  });

  describe("delete", () => {
    it("hides the user afterwards", async () => {
      const { service } = createService([existing]);

      await service.delete("1");

      await expect(service.findById("1")).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it("throws a 404 for an unknown or already deleted user", async () => {
      const { service } = createService([
        { ...existing, deletedAt: new Date() },
      ]);

      await expect(service.delete("1")).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });
});
