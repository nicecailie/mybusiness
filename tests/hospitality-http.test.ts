import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import type { Context } from '../packages/contracts/src/index.js';
const origin = 'http://localhost:3000';
async function actor(email: string, business: string) {
  const r = await fetch(origin + '/api/auth/sign-in/email', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: process.env.DEMO_PASSWORD }),
  });
  assert.equal(r.status, 200, email);
  const cookie = r.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const contexts = (await (
    await fetch(origin + '/api/v1/contexts', { headers: { cookie } })
  ).json()) as Context[];
  const c = contexts.find((c) => c.businessName === business)!;
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
void test('B–D HTTP: scoped worker routes, money-free kitchen/housekeeping responses, state transitions and denied finance', async () => {
  const waiter = await actor('waiter@example.test', 'Restaurant Lac'),
    kitchen = await actor('kitchen@example.test', 'Restaurant Lac'),
    reception = await actor('receptionist@example.test', 'Hôtel Lac');
  const get = (path: string, headers = waiter) => fetch(origin + '/api/v1/' + path, { headers });
  const post = (path: string, body: unknown, headers = waiter) =>
    fetch(origin + '/api/v1/' + path, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify(body),
    });
  const catalog = (await (await get('products?limit=100')).json()) as {
    items: { id: string; type: string; cost?: string }[];
  };
  assert.ok(catalog.items.every((p) => p.cost === undefined));
  const p = catalog.items.find((p) => p.type === 'service')!;
  const created = await post('restaurant/orders', {
    lines: [{ productId: p.id, quantity: 1, kind: 'food' }],
  });
  assert.equal(created.status, 201);
  const order = (await created.json()) as { id: string };
  let queue = (await (await get('restaurant/kitchen', kitchen)).json()) as {
    orders: { id: string; status: string; lines: unknown[] }[];
  };
  assert.ok(queue.orders.some((o) => o.id === order.id));
  assert.equal(/price|cost|total|payment/i.test(JSON.stringify(queue)), false);
  for (const status of ['preparing', 'ready'])
    assert.equal(
      (await post(`restaurant/orders/${order.id}/status`, { status }, kitchen)).status,
      201,
    );
  queue = (await (await get('restaurant/kitchen', kitchen)).json()) as typeof queue;
  assert.equal(
    queue.orders.some((o) => o.id === order.id),
    false,
  );
  for (const h of [waiter, kitchen, reception])
    for (const path of ['suppliers', 'money?from=2026-11-04&to=2026-11-04', 'staff', 'invoices'])
      assert.equal((await get(path, h)).status, 403, path);
  assert.equal(
    (
      await post(
        `restaurant/orders/${order.id}/pay`,
        { cashSessionId: randomUUID(), tendered: '10000', payment: { method: 'cash' } },
        kitchen,
      )
    ).status,
    403,
  );
  assert.equal(
    (await get('restaurant/kitchen', { ...kitchen, 'x-branch-id': randomUUID() })).status,
    403,
  );
  const rooms = (await (await get('accommodation', reception)).json()) as {
    rooms: { id: string }[];
  };
  assert.ok(rooms.rooms.length >= 2);
  assert.equal(
    (
      await post(
        'accommodation/stays',
        {
          roomId: rooms.rooms[0]!.id,
          guest: { name: 'Invalid dates' },
          checkIn: 'bad',
          checkOut: 'bad',
        },
        reception,
      )
    ).status,
    400,
  );
  await setTimeout(11000);
  const cleaner = await actor('housekeeping@example.test', 'Hôtel Lac');
  const response = await get('accommodation/housekeeping', cleaner);
  assert.equal(response.status, 200);
  const clean = (await response.json()) as { rooms: unknown[] };
  assert.equal(/rate|guest|total|price|deposit|balance/i.test(JSON.stringify(clean)), false);
  assert.equal((await get('accommodation', cleaner)).status, 403);
});
