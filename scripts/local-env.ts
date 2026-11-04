import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { userInfo } from 'node:os';
if (existsSync('.env')) throw new Error('.env already exists; preserve it.');
const password = randomBytes(24).toString('hex'),
  secret = randomBytes(32).toString('hex'),
  demoPassword = randomBytes(12).toString('hex');
const admin = new Pool({
  connectionString: `postgresql://${encodeURIComponent(process.env.PGUSER ?? userInfo().username)}@127.0.0.1:55439/postgres`,
});
await admin.query(
  `CREATE ROLE mybusiness_app LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
);
await admin.query('CREATE DATABASE mybusiness');
await admin.end();
writeFileSync(
  '.env',
  [
    `MIGRATION_DATABASE_URL=postgresql://${encodeURIComponent(process.env.PGUSER ?? userInfo().username)}@127.0.0.1:55439/mybusiness`,
    `DATABASE_URL=postgresql://mybusiness_app:${password}@127.0.0.1:55439/mybusiness`,
    `BETTER_AUTH_SECRET=${secret}`,
    'BETTER_AUTH_URL=http://localhost:3000',
    'WEB_ORIGIN=http://localhost:3000',
    'API_URL=http://127.0.0.1:4000',
    'API_PORT=4000',
    'EXPO_PUBLIC_API_URL=http://127.0.0.1:4000',
    'ALLOW_DEMO_SEED=true',
    'ALLOW_REGISTRATION=false',
    'DEMO_OWNER_EMAIL=owner@example.test',
    `DEMO_PASSWORD=${demoPassword}`,
    '',
  ].join('\n'),
  { mode: 0o600 },
);
console.log('Created isolated database and ignored local environment. No credentials printed.');
