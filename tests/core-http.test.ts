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
    'purchasing',
    'money?from=2026-11-04&to=2026-11-04',
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
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Bujumbura',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const productReply = await post('products', {
    name: 'HTTP workspace product',
    sku: randomUUID(),
    category: 'Tests',
    price: '200',
    cost: '0',
    lowStock: 1,
    type: 'goods',
  });
  assert.equal(productReply.status, 201);
  const product = (await productReply.json()) as { id: string };
  const entry = {
      supplier: { name: 'HTTP inline ' + randomUUID() },
      mode: 'order',
      orderDate: date,
      lines: [{ productId: product.id, quantity: 3, unitCost: '100' }],
    },
    entryKey = randomUUID();
  const purchaseResponse = await post('purchasing', entry, owner, entryKey);
  assert.equal(purchaseResponse.status, 201);
  const purchase = (await purchaseResponse.json()) as { id: string };
  assert.deepEqual(await (await post('purchasing', entry, owner, entryKey)).json(), purchase);
  const workspace = (await (
    await fetch(origin + '/api/v1/purchasing?id=' + purchase.id, { headers: owner })
  ).json()) as { items: { lines: { id: string }[] }[] };
  const receiptKey = randomUUID(),
    receiptBody = { lines: [{ lineId: workspace.items[0]!.lines[0]!.id, quantity: 1 }] };
  const received = await post(`purchasing/${purchase.id}/receive`, receiptBody, owner, receiptKey);
  assert.equal(received.status, 201);
  assert.deepEqual(
    await received.json(),
    await (await post(`purchasing/${purchase.id}/receive`, receiptBody, owner, receiptKey)).json(),
  );
  assert.equal(
    (
      await post(`purchasing/${purchase.id}/pay`, {
        amount: '50',
        account: '1000 Cash',
        reference: 'HTTP partial',
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await post(`purchasing/${purchase.id}/pay`, {
        account: '1000 Cash',
        reference: 'HTTP remaining',
      })
    ).status,
    201,
  );
  const final = (await (
    await fetch(origin + '/api/v1/purchasing?id=' + purchase.id, { headers: owner })
  ).json()) as { items: { owed: string; paid: string }[] };
  assert.equal(final.items[0]!.owed, '0');
  assert.equal(final.items[0]!.paid, '100');
  assert.equal(
    (
      await post(
        `purchasing/${purchase.id}/pay`,
        { amount: '1', account: '1000 Cash', reference: 'Denied' },
        cashier,
      )
    ).status,
    403,
  );
});
