// Prints a one-time web login link without Discord (dev only).
//   pnpm db:login [discordUserId]   (default: the first seeded user)
import { eq } from 'drizzle-orm';
import { createLoginToken } from '../auth.js';
import { createDb } from '../client.js';
import { users } from '../schema.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL must be set');
  process.exit(1);
}
const discordUserId = process.argv[2] ?? 'seed-u1';
const webBaseUrl = process.env.WEB_BASE_URL || 'http://localhost:3000';

const { db, pool } = createDb(databaseUrl);
try {
  const [user] = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.discordUserId, discordUserId));
  if (!user) {
    console.error(`No user with discord_user_id '${discordUserId}'`);
    process.exitCode = 1;
  } else {
    const token = await createLoginToken(db, user.id);
    console.log(
      `Login link for ${user.displayName} (valid 15 min, single use):`,
    );
    console.log(`${webBaseUrl}/auth/callback?token=${token}`);
  }
} finally {
  await pool.end();
}
