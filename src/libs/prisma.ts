import { PrismaClient } from "@prisma/client";

/**
 * Shared Prisma client instance for the application.
 *
 * Keep database access inside repositories. Import this client in module
 * factories to inject it into repository implementations.
 */
export const prisma = new PrismaClient();

/**
 * Gracefully closes the Prisma connection pool.
 */
export const disconnectPrisma = () => prisma.$disconnect();
