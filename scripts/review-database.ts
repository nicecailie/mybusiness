// Isolated local review validation; never repairs checksums or resets the working database.
import 'dotenv/config';
import { Pool } from 'pg';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const owner = new URL(process.env.MIGRATION_DATABASE_URL!);
if (!['127.0.0.1', 'localhost'].includes(owner.hostname) || process.env.ALLOW_DEMO_SEED !== 'true')
  throw new Error('Review validation requires an isolated local demo environment.');
const runtime = new URL(process.env.DATABASE_URL!);
const state = '.data/review-test-database.json';
let name: string;
try {
  name = JSON.parse(await readFile(state, 'utf8')).name;
} catch {
  name = `mybusiness_review_${Date.now()}`;
  const admin = new Pool({ connectionString: owner.href });
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  await writeFile(state, JSON.stringify({ name }), { mode: 0o600 });
}
if (!/^mybusiness_review_\d+$/.test(name)) throw new Error('Invalid isolated database name.');
owner.pathname = '/' + name;
runtime.pathname = '/' + name;
const args = process.argv.slice(2);
const result = spawnSync(args[0] ?? 'pnpm', args.length ? args.slice(1) : ['db:migrate'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: runtime.href,
    MIGRATION_DATABASE_URL: owner.href,
    ALLOW_DEMO_SEED: 'true',
  },
});
process.exitCode = result.status ?? 1;
