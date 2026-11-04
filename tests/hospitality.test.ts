import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Scope, Role } from '../packages/contracts/src/index.js';
import { db, pool, scoped } from '../apps/api/src/database.js';
import { createProduct, receiveStock } from '../apps/api/src/catalog.js';
import { openCash } from '../apps/api/src/cash.js';
import { finalizeSale, returnSale, getReceipt } from '../apps/api/src/sales.js';
import { variants, saveRecipe, expiryDashboard } from '../apps/api/src/retail.js';
import {
  createOrder,
  appendOrder,
  transitionOrder,
  payOrder,
  kitchenQueue,
} from '../apps/api/src/restaurant.js';
import { addRoom } from '../apps/api/src/business.js';
import {
  bookStay,
  takeDeposit,
  stayAction,
  checkoutStay,
  payStay,
  hotelBoard,
  housekeeping,
  cleanRoom,
  roomCharge,
  stayBill,
} from '../apps/api/src/hotel.js';
import { financialReport } from '../apps/api/src/core.js';
import { can } from '../packages/domain/src/index.js';
if (process.env.ALLOW_DEMO_SEED !== 'true') throw new Error('Use an isolated demo database.');
const id = () => randomUUID(),
  admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const tenant = id(),
  business = id(),
  branch = id(),
  other = id();
const actors = new Map<Role, string>();
const scope = (role: Role = 'owner', branchId = branch): Scope => ({
  tenantId: tenant,
  businessId: business,
  branchId,
  userId: actors.get(role)!,
  role: 'viewer',
  requestId: id(),
});
const today = new Date().toISOString().slice(0, 10),
  future = '2030-12-31',
  past = '2020-01-01';
const product = async (name: string, type: 'goods' | 'service' = 'goods', extra = {}) =>
  (
    await createProduct(scope(), id(), {
      name,
      sku: id(),
      category: 'Phase B-D',
      price: '1000',
      cost: '100',
      lowStock: 2,
      type,
      ...extra,
    })
  ).id;
const balance = async (p: string) =>
  (
    await admin.query(
      'SELECT on_hand::text,value::text FROM stock_balances WHERE branch_id=$1 AND product_id=$2',
      [branch, p],
    )
  ).rows[0];
const account = async (code: string) =>
  (
    await admin.query(
      'SELECT coalesce(sum(debit-credit),0)::text AS n FROM journal_lines WHERE business_id=$1 AND account LIKE $2',
      [business, code + '%'],
    )
  ).rows[0].n as string;
let cash: string;
before(async () => {
  await admin.query("INSERT INTO tenants(id,name,demo) VALUES($1,'Hospitality tests',true)", [
    tenant,
  ]);
  await admin.query(
    "INSERT INTO businesses(id,tenant_id,name,industry_id) VALUES($1,$2,'Hospitality tests','hotel')",
    [business, tenant],
  );
  for (const b of [branch, other])
    await admin.query(
      "INSERT INTO branches(id,tenant_id,business_id,name) VALUES($1,$2,$3,'Branch')",
      [b, tenant, business],
    );
  for (const role of [
    'owner',
    'waiter',
    'kitchen',
    'cashier',
    'receptionist',
    'housekeeping',
  ] as Role[]) {
    const actor = id();
    actors.set(role, actor);
    await admin.query(
      'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',
      [actor, role, actor + '@example.test'],
    );
    await admin.query(
      'INSERT INTO memberships(id,user_id,tenant_id,business_id,branch_id,role) VALUES($1,$2,$3,$4,$5,$6)',
      [id(), actor, tenant, business, branch, role],
    );
  }
  await admin.query(
    'INSERT INTO memberships(id,user_id,tenant_id,business_id,branch_id,role) VALUES($1,$2,$3,$4,$5,$6)',
    [id(), actors.get('owner'), tenant, business, other, 'owner'],
  );
  cash = (await openCash(scope(), id(), '0')).id;
});
void test('B: variants are distinct stable stock IDs; replay is idempotent and shared stock/returns stay isolated', async () => {
  const base = await product('Shirt');
  const result = await variants(scope(), id(), base, {
    variants: [
      { label: 'Blue M', sku: id(), price: '1000' },
      { label: 'Red L', sku: id(), price: '1200' },
    ],
  });
  const blue = result.ids[0]!,
    red = result.ids[1]!;
  await receiveStock(scope(), id(), {
    productId: blue,
    quantity: 4,
    unitCost: '100',
    reason: 'Variant delivery',
    direction: 'increase',
  });
  const key = id(),
    input = { cashSessionId: cash, tendered: '2000', lines: [{ productId: blue, quantity: 2 }] };
  const sale = await finalizeSale(scope(), key, input);
  assert.equal((await finalizeSale(scope(), key, input)).id, sale.id);
  assert.equal((await balance(blue)).on_hand, '2.000');
  assert.equal(await balance(red), undefined);
  const receipt = await getReceipt(scope(), sale.id);
  await returnSale(scope(), id(), sale.id, {
    cashSessionId: cash,
    reason: 'Variant returned',
    lines: [{ saleLineId: receipt.lines[0]!.id, quantity: 1, disposition: 'restockable' }],
  });
  assert.equal((await balance(blue)).on_hand, '3.000');
});
void test('B: FEFO consumes earliest unexpired lots, blocks expired stock and restores captured lots on return', async () => {
  const p = await product('Milk', 'goods', { batchTracked: true });
  for (const [expiresOn, quantity] of [
    [future, 3],
    ['2029-01-01', 2],
    [past, 4],
  ] as const)
    await receiveStock(scope(), id(), {
      productId: p,
      quantity,
      unitCost: '100',
      reason: 'Milk lot delivery',
      direction: 'increase',
      expiresOn,
    });
  const sale = await finalizeSale(scope(), id(), {
    cashSessionId: cash,
    tendered: '3000',
    lines: [{ productId: p, quantity: 3 }],
  });
  const lots = (
    await admin.query(
      'SELECT expires_on,on_hand::text FROM stock_batches WHERE product_id=$1 ORDER BY expires_on',
      [p],
    )
  ).rows;
  assert.deepEqual(
    lots.map((x) => x.on_hand),
    ['4.000', '0.000', '2.000'],
  );
  await assert.rejects(
    () =>
      finalizeSale(scope(), id(), {
        cashSessionId: cash,
        tendered: '3000',
        lines: [{ productId: p, quantity: 3 }],
      }),
    { code: 'EXPIRY_STOCK_UNAVAILABLE' },
  );
  const line = (await getReceipt(scope(), sale.id)).lines[0]!;
  await returnSale(scope(), id(), sale.id, {
    cashSessionId: cash,
    reason: 'Unopened milk',
    lines: [{ saleLineId: line.id, quantity: 1, disposition: 'restockable' }],
  });
  const restored = (
    await admin.query(
      "SELECT on_hand::text FROM stock_batches WHERE product_id=$1 AND expires_on='2029-01-01'",
      [p],
    )
  ).rows[0];
  assert.equal(restored.on_hand, '1.000');
  assert.equal(
    (await expiryDashboard(scope())).items.some((x) => x.productId === p && x.status === 'expired'),
    true,
  );
  await scoped(scope('owner', other), 'stock.receive', async (tx) =>
    assert.equal(await tx.stockBatch.count({ where: { productId: p } }), 0),
  );
});
void test('B: inclusive VAT is captured in receipts and reversed cumulatively in refunds', async () => {
  const p = await product('Taxed service', 'service', { price: '1180', vatBps: 1800 });
  const before = BigInt(await account('2200'));
  const sale = await finalizeSale(scope(), id(), {
    cashSessionId: cash,
    tendered: '2360',
    lines: [{ productId: p, quantity: 2 }],
  });
  const receipt = await getReceipt(scope(), sale.id);
  assert.equal(receipt.tax, '360');
  assert.equal(BigInt(await account('2200')) - before, -360n);
  for (let i = 0; i < 2; i++)
    await returnSale(scope(), id(), sale.id, {
      cashSessionId: cash,
      reason: 'Service cancelled',
      lines: [{ saleLineId: receipt.lines[0]!.id, quantity: 1, disposition: 'restockable' }],
    });
  assert.equal(BigInt(await account('2200')), before);
});
void test('C: waiter and kitchen transition orders without finance access; concurrent payment consumes captured recipe once', async () => {
  const ingredient = await product('Rice', 'goods', { initialQuantity: 10 });
  const menu = await product('Lunch recipe', 'service');
  await saveRecipe(scope(), id(), menu, {
    ingredients: [{ productId: ingredient, quantity: 0.5 }],
  });
  const order = await createOrder(scope('waiter'), id(), {
    lines: [{ productId: menu, quantity: 1, kind: 'food', notes: 'No salt' }],
  });
  await appendOrder(scope('waiter'), id(), order.id, {
    lines: [{ productId: menu, quantity: 1, kind: 'food' }],
  });
  const queue = await kitchenQueue(scope('kitchen'));
  const card = queue.orders.find((o) => o.id === order.id)!;
  assert.equal(card.lines[0]!.quantity, 2);
  assert.equal(card.lines[0]!.notes, 'No salt');
  assert.equal(/price|cost|total|tendered|payment/i.test(JSON.stringify(card)), false);
  await assert.rejects(
    () =>
      payOrder(scope(), id(), order.id, {
        cashSessionId: cash,
        tendered: '2000',
        payment: { method: 'cash' },
      }),
    { code: 'ORDER_NOT_READY' },
  );
  await transitionOrder(scope('kitchen'), id(), order.id, 'preparing');
  await transitionOrder(scope('kitchen'), id(), order.id, 'ready');
  await assert.rejects(
    () =>
      payOrder(scope('kitchen'), id(), order.id, {
        cashSessionId: cash,
        tendered: '2000',
        payment: { method: 'cash' },
      }),
    { code: 'FORBIDDEN' },
  );
  const [sale, retry] = await Promise.all([
    payOrder(scope(), id(), order.id, {
      cashSessionId: cash,
      tendered: '2000',
      payment: { method: 'cash' },
    }),
    payOrder(scope(), id(), order.id, {
      cashSessionId: cash,
      tendered: '2000',
      payment: { method: 'cash' },
    }),
  ]);
  assert.equal(sale.id, retry.id);
  assert.equal((await balance(ingredient)).on_hand, '9.000');
  // A changed recipe must never change historical return quantities or cost.
  await saveRecipe(scope(), id(), menu, { ingredients: [] });
  const line = (await getReceipt(scope(), sale.id)).lines[0]!;
  await returnSale(scope(), id(), sale.id, {
    cashSessionId: cash,
    reason: 'Kitchen return',
    lines: [{ saleLineId: line.id, quantity: 1, disposition: 'restockable' }],
  });
  assert.equal((await balance(ingredient)).on_hand, '9.500');
  assert.equal(can('waiter', 'finance.read'), false);
  assert.equal(can('kitchen', 'catalog.read'), false);
  await assert.rejects(() => scoped(scope('waiter'), 'supplier.read', async () => true), {
    code: 'FORBIDDEN',
  });
});
void test('D: booking overlap serializes, deposits stay liabilities, checkout issues one bill and applies deposit with partial payment', async () => {
  const room = await addRoom(scope(), id(), { name: '101', rate: '10000' });
  const input = {
    roomId: room.id,
    guest: { name: 'Test Guest', phone: '' },
    checkIn: today,
    checkOut: '2030-01-01',
    guestCount: 2,
    deposit: { amount: '3000', account: '1000 Cash' as const, reference: 'Booking deposit' },
  };
  // Use one night to keep the bill easy to audit.
  const next = new Date(today + 'T12:00:00Z');
  next.setUTCDate(next.getUTCDate() + 1);
  input.checkOut = next.toISOString().slice(0, 10);
  const revenueBefore = await account('4'),
    depositBefore = BigInt(await account('2300'));
  const booked = await bookStay(scope('receptionist'), id(), input);
  assert.equal(await account('4'), revenueBefore);
  assert.equal(BigInt(await account('2300')) - depositBefore, -3000n);
  const raced = await Promise.allSettled([
    bookStay(scope('receptionist'), id(), input),
    bookStay(scope('receptionist'), id(), input),
  ]);
  assert.equal(
    raced.every((x) => x.status === 'rejected'),
    true,
  );
  await stayAction(scope('receptionist'), id(), booked.id, 'check_in');
  const billInput = {
    extras: [{ name: 'Laundry', amount: '2000' }],
    payment: { amount: '4000', account: '1000 Cash' as const, reference: 'Checkout partial' },
  };
  const [invoice, retry] = await Promise.all([
    checkoutStay(scope('receptionist'), id(), booked.id, billInput),
    checkoutStay(scope('receptionist'), id(), booked.id, billInput),
  ]);
  assert.equal(invoice.id, retry.id);
  const bill = (
    await admin.query('SELECT total::text,paid::text,status FROM invoices WHERE id=$1', [
      invoice.id,
    ])
  ).rows[0];
  assert.deepEqual(bill, { total: '12000', paid: '7000', status: 'issued' });
  assert.equal(BigInt(await account('2300')), depositBefore);
  const house = await housekeeping(scope('housekeeping'));
  assert.equal(/rate|total|guest|deposit|payment|balance/i.test(JSON.stringify(house)), false);
  assert.equal(house.rooms.find((r) => r.id === room.id)?.status, 'needs_cleaning');
  await cleanRoom(scope('housekeeping'), id(), room.id, 'cleaning');
  await cleanRoom(scope('housekeeping'), id(), room.id, 'available');
  await payStay(scope('receptionist'), id(), booked.id, {
    amount: '5000',
    account: '1010 Bank',
    reference: 'Final balance',
  });
  await assert.rejects(
    () =>
      payStay(scope('receptionist'), id(), booked.id, {
        amount: '1',
        account: '1000 Cash',
        reference: 'Excess',
      }),
    { code: 'INVALID_STATE' },
  );
  await assert.rejects(() => hotelBoard(scope('housekeeping')), { code: 'FORBIDDEN' });
  await assert.rejects(() => scoped(scope('receptionist'), 'finance.read', async () => true), {
    code: 'FORBIDDEN',
  });
});
void test('D: restaurant room charge posts stock/revenue once and checkout clears the guest charge without duplicate income', async () => {
  const room = await addRoom(scope(), id(), { name: '102', rate: '5000' });
  const next = new Date(today + 'T12:00:00Z');
  next.setUTCDate(next.getUTCDate() + 1);
  const stay = await bookStay(scope(), id(), {
    roomId: room.id,
    guest: { name: 'Room diner', phone: '' },
    checkIn: today,
    checkOut: next.toISOString().slice(0, 10),
    guestCount: 1,
  });
  await stayAction(scope(), id(), stay.id, 'check_in');
  const drink = await product('Room drink', 'goods', { initialQuantity: 5 });
  const order = await createOrder(scope('waiter'), id(), {
    lines: [{ productId: drink, quantity: 1, kind: 'drink' }],
  });
  await transitionOrder(scope('kitchen'), id(), order.id, 'ready');
  const before = BigInt(await account('4010'));
  const charge = await roomCharge(scope(), id(), order.id, stay.id);
  assert.equal((await balance(drink)).on_hand, '4.000');
  assert.equal(BigInt(await account('4010')) - before, -1000n);
  assert.equal(
    (await admin.query('SELECT id FROM payments WHERE sale_id=$1', [charge.id])).rowCount,
    0,
  );
  assert.equal(await account('1400'), '1000');
  await checkoutStay(scope(), id(), stay.id, { extras: [] });
  assert.equal(await account('1400'), '0');
  const guestBill = await stayBill(scope(), stay.id);
  assert.equal(guestBill.restaurantCharges[0]?.lines[0]?.name, 'Room drink');
  assert.equal(BigInt(await account('4010')) - before, -1000n);
  assert.equal((await balance(drink)).on_hand, '4.000');
  const report = (await financialReport(scope(), today, today)) as {
    restaurantRevenue: string;
    accommodationRevenue: string;
  };
  assert.ok(BigInt(report.restaurantRevenue) > 0n);
  assert.ok(BigInt(report.accommodationRevenue) > 0n);
});
void test('D: cancelling reservations refunds held deposits and releases the date range', async () => {
  const room = await addRoom(scope(), id(), { name: '103', rate: '7000' });
  const input = {
    roomId: room.id,
    guest: { name: 'Cancel guest', phone: '' },
    checkIn: '2031-01-01',
    checkOut: '2031-01-02',
    guestCount: 1,
  };
  const before = await account('2300');
  const s = await bookStay(scope(), id(), input);
  await takeDeposit(scope(), id(), s.id, {
    amount: '2000',
    account: '1010 Bank',
    reference: 'Bank deposit',
  });
  await stayAction(scope(), id(), s.id, 'cancelled');
  assert.equal(await account('2300'), before);
  await bookStay(scope(), id(), input);
});
void test('B–D: all journals balance and specialized roles cannot cross branch or forge their effective role', async () => {
  const result = await admin.query(
    'SELECT j.id FROM journals j JOIN journal_lines l ON l.journal_id=j.id WHERE j.business_id=$1 GROUP BY j.id HAVING sum(l.debit-l.credit)<>0',
    [business],
  );
  assert.equal(result.rowCount, 0);
  await assert.rejects(
    () => hotelBoard({ ...scope('receptionist'), branchId: other, role: 'owner' }),
    { code: 'FORBIDDEN' },
  );
  await assert.rejects(
    () => scoped({ ...scope('kitchen'), role: 'owner' }, 'finance.read', async () => true),
    { code: 'FORBIDDEN' },
  );
});
after(async () => {
  await admin.end();
  await db.$disconnect();
  await pool.end();
});

void test('B: variant offline replay retains signed tax/price and never merges another variant', async () => {
  const { registerDevice, offlineCatalog, ingestOfflineSale } =
    await import('../apps/api/src/offline.js');
  const base = await product('Offline variant base'),
    v = await variants(scope(), id(), base, {
      variants: [{ label: 'Small', sku: id(), price: '1000' }],
    });
  const child = v.ids[0]!;
  await receiveStock(scope(), id(), {
    productId: child,
    quantity: 4,
    unitCost: '100',
    reason: 'Offline variant stock',
    direction: 'increase',
  });
  const device = id();
  await registerDevice(scope(), device);
  const catalog = await offlineCatalog(scope(), device),
    p = catalog.items.find((p) => p.id === child)!;
  const input = {
    saleId: id(),
    deviceId: device,
    userId: actors.get('owner')!,
    tenantId: tenant,
    businessId: business,
    branchId: branch,
    cashSessionId: cash,
    localTime: new Date().toISOString(),
    lastSyncedAt: catalog.syncedAt,
    total: '1000',
    tendered: '1000',
    payment: { method: 'cash' as const },
    reason: '',
    lines: [
      {
        productId: child,
        name: p.name,
        sku: p.sku,
        quantity: 1,
        unitPrice: p.price,
        discount: '0',
        total: '1000',
        lastKnownStock: p.onHand,
        catalogProof: p.offlineProof!,
      },
    ],
  };
  const sale = await ingestOfflineSale(scope(), input);
  assert.equal((await ingestOfflineSale(scope(), input)).id, sale.id);
  assert.equal((await balance(child)).on_hand, '3.000');
  assert.equal(await balance(base), undefined);
});
void test('B: receipt lots survive branch transfer and expired stock can be written off without becoming sellable', async () => {
  const core = await import('../apps/api/src/core.js');
  const p = await product('Batch transfer', 'goods', { batchTracked: true });
  const supplier = await core.saveSupplier(scope(), id(), { name: 'Lot supplier' });
  const order = await core.savePurchase(scope(), id(), {
    supplierId: supplier.id,
    orderDate: today,
    lines: [{ productId: p, quantity: 4, unitCost: '100' }],
  });
  await core.purchaseAction(scope(), id(), order.id, 'order');
  const line = (await admin.query('SELECT id FROM purchase_lines WHERE order_id=$1', [order.id]))
    .rows[0].id as string;
  await core.receivePurchase(scope(), id(), order.id, {
    lines: [{ lineId: line, quantity: 4, expiresOn: future }],
  });
  const transfer = await core.createTransfer(scope(), id(), {
    destinationId: other,
    lines: [{ productId: p, quantity: 2 }],
  });
  await core.transferAction(scope(), id(), transfer.id, 'send');
  await core.transferAction(scope('owner', other), id(), transfer.id, 'receive');
  const dest = (
    await admin.query(
      'SELECT on_hand::text,expires_on FROM stock_batches WHERE branch_id=$1 AND product_id=$2',
      [other, p],
    )
  ).rows[0];
  assert.deepEqual(dest, { on_hand: '2.000', expires_on: future });
  assert.equal((await balance(p)).on_hand, '2.000');
  const expired = await product('Expired writeoff', 'goods', { batchTracked: true });
  await receiveStock(scope(), id(), {
    productId: expired,
    quantity: 1,
    unitCost: '100',
    reason: 'Expired lot for review',
    direction: 'increase',
    expiresOn: past,
  });
  await receiveStock(scope(), id(), {
    productId: expired,
    quantity: 1,
    unitCost: '0',
    reason: 'Expired stock writeoff',
    direction: 'decrease',
  });
  assert.equal((await balance(expired)).on_hand, '0.000');
});

void test('B: quick variant grid opens independent quantity and weighted cost in the shared ledger', async () => {
  const base = await product('Variant opening base');
  const v = await variants(scope(), id(), base, {
    variants: [{ label: 'Large', sku: id(), price: '2000', cost: '300', quantity: 2 }],
  });
  assert.deepEqual(await balance(v.ids[0]!), { on_hand: '2.000', value: '600' });
});
