import 'dotenv/config';
import { getMigrations } from 'better-auth/db/migration';
import { twoFactor } from 'better-auth/plugins';
import { Pool } from 'pg';
import { writeFileSync } from 'node:fs';
const database = new Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
const migrations = await getMigrations({ database, plugins: [twoFactor()] });
writeFileSync(
  'prisma/migrations/202610270003_identity/migration.sql',
  await migrations.compileMigrations(),
);
await database.end();
console.log('Generated identity migration for review.');
