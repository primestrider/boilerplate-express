/**
 * Promotes an existing user to admin.
 *
 *   npm run user:make-admin -- someone@example.com     (development)
 *   node dist/cli/make-admin.js someone@example.com    (after build)
 *
 * The user must log in again (or refresh) to get a token with the new role.
 */
import { env } from "../config/env";
import { createDatabase } from "../db";
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

    await repository.updateRole(user.id, "admin");
    console.log(`${user.email} is now an admin`);
    return 0;
  } finally {
    db.$client.close();
  }
};

main().then((code) => process.exit(code));
