import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Context, Receipt, Dashboard, CashSession } from '../packages/contracts/src/index.js';
const origin = 'http://localhost:3000';
async function login(email: string) {
  const response = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin },
    body: JSON.stringify({ email, password: process.env.DEMO_PASSWORD }),
  });
  assert.equal(response.status, 200);
  const cookies = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  assert.ok(cookies);
  return cookies;
}
void test('HTTP authentication, authorization, validation, CSRF and connected sale/return contracts', async () => {
  assert.equal((await fetch(`${origin}/api/v1/contexts`)).status, 401);
  const cookie = await login(process.env.DEMO_OWNER_EMAIL ?? 'owner@example.test');
  const contextsResponse = await fetch(`${origin}/api/v1/contexts`, {
    headers: { cookie },
  });
  assert.equal(contextsResponse.status, 200);
  const contexts = (await contextsResponse.json()) as Context[];
  assert.equal(contexts.length, 3);
  const c = contexts.find((c) => c.role === 'owner' && c.branchName === 'Centre-ville')!;
  const headers = {
    cookie,
    origin,
    'Content-Type': 'application/json',
    'x-tenant-id': c.tenantId,
    'x-business-id': c.businessId,
    'x-branch-id': c.branchId,
  };
  const post = async (path: string, body: unknown, key = randomUUID()) =>
    fetch(`${origin}/api/v1/${path}`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': key },
      body: JSON.stringify(body),
    });
  const invalid = await post('products', { name: 'x' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'VALIDATION_ERROR');
  const csrf = await fetch(`${origin}/api/v1/products`, {
    method: 'POST',
    headers: { ...headers, origin: 'https://attacker.invalid' },
    body: '{}',
  });
  assert.equal(csrf.status, 403);
  const productResponse = await post('products', {
    name: 'HTTP test product',
    sku: `HTTP-${randomUUID().slice(0, 8)}`,
    category: 'Tests',
    price: '15000',
    cost: '10000',
    lowStock: 1,
    type: 'goods',
  });
  assert.equal(productResponse.status, 201);
  const product = (await productResponse.json()) as { id: string };
  assert.equal(
    (
      await post('stock/opening', {
        productId: product.id,
        quantity: 20,
        unitCost: '10000',
        reason: 'HTTP acceptance fixture',
      })
    ).status,
    201,
  );
  const sessionResponse = await fetch(`${origin}/api/v1/cash-session`, {
    headers,
  });
  let cash = (await sessionResponse.json()) as CashSession | null;
  if (!cash) {
    const opened = await post('cash-session', { openingFloat: '50000' });
    cash = (await opened.json()) as CashSession;
  }
  const key = randomUUID(),
    payload = {
      lines: [{ productId: product.id, quantity: 2 }],
      tendered: '40000',
      cashSessionId: cash.id,
    };
  const first = await post('sales', payload, key);
  assert.equal(first.status, 201);
  const sale = (await first.json()) as { id: string };
  const retry = await post('sales', payload, key);
  assert.equal((await retry.json()).id, sale.id);
  const receiptResponse = await fetch(`${origin}/api/v1/sales/${sale.id}`, {
    headers,
  });
  assert.equal(receiptResponse.status, 200);
  const receipt = (await receiptResponse.json()) as Receipt;
  assert.equal(receipt.total, '30000');
  assert.equal(receipt.change, '10000');
  const returned = await post(`sales/${sale.id}/returns`, {
    lines: [
      {
        saleLineId: receipt.lines[0]!.id,
        quantity: 1,
        disposition: 'restockable',
      },
    ],
    reason: 'HTTP return acceptance',
    cashSessionId: cash.id,
  });
  assert.equal(returned.status, 201);
  assert.equal((await returned.json()).total, '15000');
  const cashier = await login('cashier@example.test');
  const denied = await fetch(`${origin}/api/v1/journals`, {
    headers: { ...headers, cookie: cashier },
  });
  assert.equal(denied.status, 403);
  const foreign = contexts.find((x) => x.role === 'viewer')!;
  assert.equal(
    (
      await fetch(`${origin}/api/v1/products`, {
        headers: {
          ...headers,
          cookie: cashier,
          'x-tenant-id': foreign.tenantId,
          'x-business-id': foreign.businessId,
          'x-branch-id': foreign.branchId,
        },
      })
    ).status,
    403,
  );
  const reportResponse = await fetch(`${origin}/api/v1/dashboard?from=2026-10-01&to=2026-10-31`, {
    headers,
  });
  assert.equal(reportResponse.status, 200);
  const report = (await reportResponse.json()) as Dashboard;
  assert.ok(report.transactionCount > 0);
  assert.equal(typeof report.netSales, 'string');
  const exported = await fetch(`${origin}/api/v1/reports/sales.csv?from=2026-10-01&to=2026-10-31`, {
    headers,
  });
  assert.equal(exported.status, 200);
  const csv = await exported.text();
  assert.ok(csv.includes(`"Net sales","${report.netSales}"`));
  assert.ok(csv.includes('"Receipt","Sale time","Synchronized at"'));
  assert.ok(csv.includes('"Payment sale ID","Method","Provider","Reference","Status"'));
  const deniedExport = await fetch(
    `${origin}/api/v1/reports/sales.csv?from=2026-10-01&to=2026-10-31`,
    { headers: { ...headers, cookie: cashier } },
  );
  assert.equal(deniedExport.status, 403);
  const session = await fetch(`${origin}/api/auth/get-session`, {
    headers: { cookie },
  });
  assert.equal(session.status, 200);
  assert.ok((await session.json()).user);
  const signout = await fetch(`${origin}/api/auth/sign-out`, {
    method: 'POST',
    headers: { cookie, origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(signout.status, 200);
  assert.equal((await fetch(`${origin}/api/v1/contexts`, { headers: { cookie } })).status, 401);
});
