/**
 * Promotes an existing user to admin.
 *
 *   npm run user:make-admin -- someone@example.com     (development)
 *   node dist/cli/make-admin.js someone@example.com    (after build)
 *
 * The user must log in again (or refresh) to get a token with the new role.
 * With Redis, the cached user may show the old role for up to a minute.
 */
import { env } from "../config/env";
import { createDatabase } from "../db";
import { DrizzleAuditLogRepository } from "../modules/audit/audit.repository";
import { AuditService } from "../modules/audit/audit.service";
import { DrizzleUserRepository } from "../modules/users/user.repository";

const main = async () => {
  const email = process.argv[2];

  if (!email) {
    console.error("Usage: npm run user:make-admin -- <email>");
    return 1;
  }

  const db = createDatabase(env.DATABASE_URL);

  try {
    const repository = new DrizzleUserRepository(db);
    const user = await repository.findByEmail(email);

    if (!user) {
      console.error(`No user with email ${email}`);
      return 1;
    }

    if (user.role === "admin") {
      console.log(`${user.email} is already an admin`);
      return 0;
    }

    await repository.updateRole(user.id, "admin");
    await new AuditService(new DrizzleAuditLogRepository(db)).record({
      action: "user.role_changed",
      entityType: "user",
      entityId: user.id,
      actorId: null,
      metadata: { from: user.role, to: "admin", via: "cli" },
    });

    console.log(`${user.email} is now an admin`);
    return 0;
  } finally {
    await db.$client.end();
  }
};

main().then((code) => process.exit(code));
