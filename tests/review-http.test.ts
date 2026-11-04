import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  Context,
  OfflineSaleInput,
  Product,
  Receipt,
} from '../packages/contracts/src/index.js';
if (process.env.ALLOW_DEMO_SEED !== 'true') throw new Error('Use an isolated demo database.');
const origin = 'http://localhost:3000';
void test('a dropped HTTP response after the offline sale commits retries once with the same sale ID and receipt reference', async () => {
  const login = await fetch(origin + '/api/auth/sign-in/email', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.DEMO_OWNER_EMAIL ?? 'owner@example.test',
      password: process.env.DEMO_PASSWORD,
    }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const contexts = (await (
    await fetch(origin + '/api/v1/contexts', { headers: { cookie } })
  ).json()) as Context[];
  const c = contexts.find((c) => c.role === 'owner' && c.branchName === 'Centre-ville')!;
  const headers = {
    cookie,
    origin,
    'Content-Type': 'application/json',
    'x-tenant-id': c.tenantId,
    'x-business-id': c.businessId,
    'x-branch-id': c.branchId,
  };
  const post = async (path: string, input: unknown, key: string = randomUUID()) => {
    const r = await fetch(origin + '/api/v1/' + path, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': key },
      body: JSON.stringify(input),
    });
    assert.equal(r.status, 201, await r.clone().text());
    return r.json();
  };
  const product = (await post('products', {
    name: 'HTTP offline review',
    sku: randomUUID(),
    category: 'Review',
    type: 'goods',
    price: '1000',
    cost: '500',
    lowStock: 0,
    initialQuantity: 6,
  })) as { id: string };
  const deviceId = randomUUID();
  await post('offline/devices', { id: deviceId }, deviceId);
  const catalog = (await post('offline/catalog', { deviceId })) as {
      syncedAt: string;
      items: Product[];
    },
    p = catalog.items.find((p) => p.id === product.id)!;
  const register = (await (await fetch(origin + '/api/v1/cash-session', { headers })).json()) as {
    id: string;
  };
  assert.ok(register?.id);
  const input: OfflineSaleInput = {
    saleId: randomUUID(),
    deviceId,
    userId: c.userId,
    tenantId: c.tenantId,
    businessId: c.businessId,
    branchId: c.branchId,
    cashSessionId: register.id,
    localTime: new Date().toISOString(),
    lastSyncedAt: catalog.syncedAt,
    tendered: '6000',
    total: '6000',
    payment: { method: 'mobile_money', provider: 'Ecocash', reference: 'HTTP-ECO-' + randomUUID() },
    reason: '',
    lines: [
      {
        productId: p.id,
        name: p.name,
        sku: p.sku,
        unitPrice: p.price,
        quantity: 6,
        discount: '0',
        total: '6000',
        lastKnownStock: 6,
        catalogProof: p.offlineProof!,
      },
    ],
  };
  await post('sales', {
    lines: [{ productId: p.id, quantity: 4 }],
    cashSessionId: register.id,
    tendered: '4000',
  });
  let committed: { id: string; reviewRequired: boolean } | undefined, proxyError: unknown;
  const proxy = createServer((req, res) => {
    void (async () => {
      try {
        const result = await fetch(origin + '/api/v1/offline/sales', {
          method: 'POST',
          headers: { ...headers, 'Idempotency-Key': input.saleId },
          body: JSON.stringify(input),
        });
        assert.equal(result.status, 201, await result.clone().text());
        committed = (await result.json()) as typeof committed;
        res.socket!.destroy();
      } catch (error) {
        proxyError = error;
        res.destroy();
      }
    })();
    req.resume();
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(() =>
      fetch(`http://127.0.0.1:${(proxy.address() as AddressInfo).port}/upload`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    );
    if (proxyError) throw proxyError;
    assert.ok(committed);
    const retry = await post('offline/sales', input, input.saleId);
    assert.deepEqual(retry, committed);
    assert.equal(retry.id, input.saleId);
    assert.equal(retry.reviewRequired, true);
    const receipt = (await (
      await fetch(origin + '/api/v1/sales/' + retry.id, { headers })
    ).json()) as Receipt;
    assert.equal(receipt.payment?.reference, input.payment.reference);
    assert.equal(receipt.payment?.status, 'recorded_unverified');
    const stock = (await (
      await fetch(origin + '/api/v1/products?search=' + encodeURIComponent(p.sku), { headers })
    ).json()) as { items: Product[] };
    assert.equal(stock.items[0]?.onHand, -4);
    const audit = (await (await fetch(origin + '/api/v1/reconciliation', { headers })).json()) as {
      items: { saleId: string; sales: { id: string }[] }[];
    };
    assert.equal(audit.items.filter((r) => r.saleId === input.saleId).length, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      proxy.close((error) => (error ? reject(error) : resolve())),
    );
    await fetch(origin + '/api/auth/sign-out', { method: 'POST', headers, body: '{}' });
  }
});
