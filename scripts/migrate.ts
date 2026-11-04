import 'dotenv/config';
import { Pool } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
if (!process.env.MIGRATION_DATABASE_URL)
  throw new Error('Set MIGRATION_DATABASE_URL to a migration-owner connection.');
// Shared hosting prefixes database roles. Bind only this allowlisted identifier; migration
// checksums remain those of the original source SQL, including its logical runtime role.
const runtimeRole = process.env.DB_RUNTIME_ROLE ?? 'mybusiness_app';
if (!/^[a-z][a-z0-9_]{0,62}$/.test(runtimeRole)) throw new Error('Invalid DB_RUNTIME_ROLE.');
const bindRuntimeRole = (sql: string) => sql.replace(/\bmybusiness_app\b/g, runtimeRole);
const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const client = await pool.connect();
try {
  const runtime = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    'SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=$1',
    [runtimeRole],
  );
  if (!runtime.rows[0] || runtime.rows[0].rolsuper || runtime.rows[0].rolbypassrls)
    throw new Error('Runtime role must exist without superuser or BYPASSRLS.');
  const identity = await client.query<{ current_user: string }>('SELECT current_user');
  if (identity.rows[0]?.current_user === runtimeRole)
    throw new Error('Migration owner must differ from runtime role.');
  await client.query("SELECT pg_advisory_lock(hashtext('mybusiness:migrations'))");
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const name of (await readdir('prisma/migrations')).filter((n) => /^\d/.test(n)).sort()) {
    const sql = await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'),
      checksum = createHash('sha256').update(sql).digest('hex');
    if (!sql.trim()) throw new Error(`Empty migration: ${name}`);
    const existing = await client.query<{ checksum: string }>(
      'SELECT checksum FROM schema_migrations WHERE name=$1',
      [name],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum)
        throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(bindRuntimeRole(sql));
      await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
        name,
        checksum,
      ]);
      await client.query('COMMIT');
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  await client.query(
    bindRuntimeRole(
      'GRANT SELECT,INSERT,UPDATE,DELETE ON "user","session","account","verification","twoFactor" TO mybusiness_app',
    ),
  );
  await client.query(bindRuntimeRole('REVOKE ALL ON schema_migrations FROM mybusiness_app'));
  const ownerCheck = await client.query(
    "SELECT 1 FROM pg_tables WHERE schemaname='public' AND tableowner=$1 LIMIT 1",
    [runtimeRole],
  );
  if (ownerCheck.rowCount) throw new Error('Runtime role must not own application tables.');
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('mybusiness:migrations'))");
  client.release();
  await pool.end();
}
