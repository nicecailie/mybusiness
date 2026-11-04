import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Context } from '../packages/contracts/src/index.js';
const origin = 'http://localhost:3000';
async function actor(email: string) {
  const response = await fetch(origin + '/api/auth/sign-in/email', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: process.env.DEMO_PASSWORD }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const contexts = (await (
    await fetch(origin + '/api/v1/contexts', { headers: { cookie } })
  ).json()) as Context[];
  const c = contexts.find(
    (c) => c.businessName === 'Maison Kivu' && c.branchName === 'Centre-ville',
  )!;
  assert.ok(c);
  return {
    cookie,
    origin,
    'Content-Type': 'application/json',
    'x-tenant-id': c.tenantId,
    'x-business-id': c.businessId,
    'x-branch-id': c.branchId,
  };
}
void test('new core HTTP routes validate input, enforce real session permissions and tenant/branch scope', async () => {
  const owner = await actor(process.env.DEMO_OWNER_EMAIL ?? 'owner@example.test'),
    cashier = await actor('cashier@example.test');
  const post = (path: string, body: unknown, headers = owner, key = randomUUID()) =>
    fetch(origin + '/api/v1/' + path, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': key },
      body: JSON.stringify(body),
    });
  assert.equal((await post('suppliers', { name: 'x' })).status, 400);
  assert.equal((await post('suppliers', { name: 'Denied' }, cashier)).status, 403);
  for (const path of [
    'suppliers',
    'purchases',
    'invoices',
    'payables',
    'transfers',
    'stock-counts',
    'expenses?from=2026-11-04&to=2026-11-04',
    'reports/financial?from=2026-11-04&to=2026-11-04',
  ])
    assert.equal((await fetch(origin + '/api/v1/' + path, { headers: cashier })).status, 403, path);
  const key = randomUUID(),
    body = { name: 'HTTP supplier ' + key };
  const first = await post('suppliers', body, owner, key),
    retry = await post('suppliers', body, owner, key);
  assert.equal(first.status, 201);
  assert.equal(retry.status, 201);
  assert.deepEqual(await first.json(), await retry.json());
  assert.equal(
    (
      await fetch(origin + '/api/v1/suppliers', {
        headers: { ...owner, 'x-branch-id': randomUUID() },
      })
    ).status,
    403,
  );
  assert.equal(
    (await post('suppliers', { name: 'Forged tenant' }, { ...owner, 'x-tenant-id': randomUUID() }))
      .status,
    403,
  );
  assert.equal(
    (
      await post(
        'suppliers',
        { name: 'CSRF denied' },
        { ...owner, origin: 'https://attacker.invalid' },
      )
    ).status,
    403,
  );
});
