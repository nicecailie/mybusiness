import 'dotenv/config';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { db, pool, scoped, contexts } from '../apps/api/src/database.js';
import {
  createProduct,
  updateProduct,
  archiveProduct,
  restoreProduct,
  products,
  receiveStock,
} from '../apps/api/src/catalog.js';
import { finalizeSale, getReceipt, returnSale } from '../apps/api/src/sales.js';
import { openCash, closeCash, cashSession } from '../apps/api/src/cash.js';
import {
  ingestOfflineSale,
  registerDevice,
  offlineCatalog,
  reconciliation,
  resolveDiscrepancy,
} from '../apps/api/src/offline.js';
import {
  addDocument,
  businessDetails,
  updateBusiness,
  getDocument,
  addStaff,
  staff,
  addRoom,
  addStay,
  rooms,
} from '../apps/api/src/business.js';
import { provisionBusiness } from '../apps/api/src/onboarding.js';
import {
  addTable,
  createOrder,
  payOrder,
  restaurantDashboard,
} from '../apps/api/src/restaurant.js';
import { dashboard } from '../apps/api/src/reporting.js';
import {
  offlineSaleSchema,
  type Scope,
  type OfflineSaleInput,
} from '../packages/contracts/src/index.js';
if (process.env.ALLOW_DEMO_SEED !== 'true') throw new Error('Use an isolated demo database.');
const admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const userId = randomUUID(),
  tenantId = randomUUID(),
  businessId = randomUUID(),
  branchId = randomUUID(),
  deviceId = randomUUID(),
  cashierId = randomUUID();
const s: Scope = { userId, tenantId, businessId, branchId, role: 'owner', requestId: randomUUID() };
let cashSessionId: string;
const key = () => randomUUID();
const product = (quantity: number, sku = key()) =>
  createProduct(s, key(), {
    name: 'Review fabric',
    sku,
    category: 'Tests',
    type: 'goods',
    price: '800',
    cost: '400',
    lowStock: 1,
    initialQuantity: quantity,
  });
before(async () => {
  for (const id of [userId, cashierId])
    await admin.query(
      'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,\'Review actor\',$2,true,now(),now())',
      [id, `${id}@example.test`],
    );
  await admin.query("INSERT INTO tenants(id,name,demo) VALUES($1,'Review fixture',true)", [
    tenantId,
  ]);
  await admin.query("INSERT INTO businesses(id,tenant_id,name) VALUES($1,$2,'Review business')", [
    businessId,
    tenantId,
  ]);
  await admin.query(
    "INSERT INTO branches(id,tenant_id,business_id,name) VALUES($1,$2,$3,'Review branch')",
    [branchId, tenantId, businessId],
  );
  for (const [actor, role] of [
    [userId, 'owner'],
    [cashierId, 'cashier'],
  ])
    await admin.query(
      'INSERT INTO memberships(id,user_id,tenant_id,business_id,branch_id,role) VALUES($1,$2,$3,$4,$5,$6)',
      [key(), actor, tenantId, businessId, branchId, role],
    );
  cashSessionId = (await openCash(s, key(), '0')).id;
  await registerDevice(s, deviceId);
});
async function offline(productId: string, quantity = 6): Promise<OfflineSaleInput> {
  const catalog = await offlineCatalog(s, deviceId),
    p = catalog.items.find((p) => p.id === productId)!;
  const now = new Date().toISOString();
  return {
    saleId: key(),
    deviceId,
    userId,
    tenantId,
    businessId,
    branchId,
    localTime: now,
    lastSyncedAt: catalog.syncedAt,
    cashSessionId,
    total: String(800 * quantity),
    tendered: String(800 * quantity),
    payment: { method: 'mobile_money', provider: 'Lumicash', reference: 'LUMI-REVIEW-123' },
    reason: '',
    lines: [
      {
        productId,
        name: p.name,
        sku: p.sku,
        catalogProof: p.offlineProof!,
        unitPrice: '800',
        quantity,
        discount: '0',
        total: String(800 * quantity),
        lastKnownStock: p.onHand,
      },
    ],
  };
}
void test('6 opening, 4 online, 6 offline: preserve both sales, -4 inventory, one effect after parallel retries and lost acknowledgement', async () => {
  const p = await product(6);
  const input = await offline(p.id);
  const online = await finalizeSale(s, key(), {
    lines: [{ productId: p.id, quantity: 4 }],
    tendered: '3200',
    cashSessionId,
  });
  const [first, retry] = await Promise.all([
    ingestOfflineSale(s, input),
    ingestOfflineSale(s, input),
  ]);
  assert.deepEqual(first, retry);
  assert.equal(first.reviewRequired, true);
  assert.deepEqual(await ingestOfflineSale(s, input), first);
  const r = await getReceipt(s, first.id);
  assert.equal(r.offline, true);
  assert.equal(r.payment?.reference, 'LUMI-REVIEW-123');
  assert.equal(r.payment?.status, 'recorded_unverified');
  assert.equal(r.valuationPending, true);
  assert.equal(r.createdAt, input.localTime);
  assert.ok(r.syncedAt! >= r.createdAt);
  await scoped(s, 'journal.read', async (tx) => {
    const b = await tx.stockBalance.findFirstOrThrow({ where: { productId: p.id } });
    assert.equal(Number(b.onHand), -4);
    assert.equal(b.value.toString(), '0');
    assert.equal(await tx.sale.count({ where: { id: { in: [online.id, first.id] } } }), 2);
    assert.equal(await tx.payment.count({ where: { saleId: first.id } }), 1);
    assert.equal(await tx.journal.count({ where: { sourceId: first.id } }), 1);
    assert.equal(await tx.stockMovement.count({ where: { sourceId: first.id } }), 1);
    assert.equal(
      (await tx.sale.findUniqueOrThrow({ where: { id: first.id } })).cost.toString(),
      '800',
    );
  });
  await assert.rejects(
    () =>
      finalizeSale(s, key(), {
        lines: [{ productId: p.id, quantity: 0.001 }],
        tendered: '800',
        cashSessionId,
      }),
    { code: 'INSUFFICIENT_STOCK' },
  );
  await assert.rejects(() => ingestOfflineSale(s, { ...input, tendered: '99999' }), {
    code: 'IDEMPOTENCY_CONFLICT',
  });
  const review = (await reconciliation(s)).items.find((r) => r.saleId === first.id)!;
  assert.equal(review.openingAvailability, 6);
  assert.equal(review.opening, 2);
  assert.equal(review.shortage, 4);
  assert.equal(review.sales.length, 2);
  await assert.rejects(() => reconciliation({ ...s, userId: cashierId }), { code: 'FORBIDDEN' });
  await resolveDiscrepancy(s, key(), review.id, {
    action: 'outstanding_fulfillment',
    reason: 'Investigating goods not handed over',
  });
  await resolveDiscrepancy(s, key(), review.id, {
    action: 'missing_delivery',
    quantity: 4,
    reason: 'Manager reviewed delivery note DN-123; cost approval pending',
  });
  const corrected = (await reconciliation(s)).items.find((r) => r.id === review.id)!;
  assert.equal(corrected.onHand, 0);
  assert.equal(corrected.status, 'resolved');
  assert.equal(corrected.events.length, 2);
  assert.equal(corrected.events[1]?.actorId, userId);
  assert.equal(corrected.valuationPending, true);
  assert.equal((await getReceipt(s, first.id)).reviewRequired, false);
});
void test('offline identity, device and oversell policy are enforced without financial side effects', async () => {
  const p = await product(2),
    input = await offline(p.id, 1);
  await assert.rejects(() => ingestOfflineSale(s, { ...input, userId: cashierId }), {
    code: 'OFFLINE_IDENTITY_MISMATCH',
  });
  await assert.rejects(() => ingestOfflineSale(s, { ...input, deviceId: key() }), {
    code: 'DEVICE_BLOCKED',
  });
  await assert.rejects(
    () =>
      ingestOfflineSale(s, {
        ...input,
        total: '1',
        tendered: '1',
        lines: input.lines.map((l) => ({ ...l, unitPrice: '1', total: '1' })),
      }),
    { code: 'OFFLINE_CATALOG_REVIEW' },
  );

  const over = { ...input, lines: input.lines.map((l) => ({ ...l, lastKnownStock: 0 })) };
  await assert.rejects(() => ingestOfflineSale(s, over), { code: 'REASON_REQUIRED' });
  assert.equal(
    offlineSaleSchema.safeParse({ ...over, payment: { method: 'mobile_money', provider: 'iHela' } })
      .success,
    false,
  );
  await updateBusiness(s, key(), { nif: '', tva: '', offlinePolicy: 'manager_override' });
  await closeCash(
    s,
    key(),
    cashSessionId,
    (await cashSession(s))!.expected,
    'Review fixture shift change',
  );
  const cashier = { ...s, userId: cashierId },
    cashierRegister = (await openCash(cashier, key(), '0')).id,
    cashierDevice = key();
  await registerDevice(cashier, cashierDevice);
  const cashierCatalog = await offlineCatalog(cashier, cashierDevice),
    cashierProduct = cashierCatalog.items.find((p2) => p2.id === p.id)!;
  await assert.rejects(
    () =>
      ingestOfflineSale(cashier, {
        ...over,
        userId: cashierId,
        deviceId: cashierDevice,
        cashSessionId: cashierRegister,
        localTime: new Date().toISOString(),
        reason: 'Customer already received goods',
        lastSyncedAt: cashierCatalog.syncedAt,
        lines: over.lines.map((l) => ({ ...l, catalogProof: cashierProduct.offlineProof! })),
      }),
    { code: 'MANAGER_REQUIRED' },
  );
  await closeCash(cashier, key(), cashierRegister, '0', 'Review fixture shift change');
  cashSessionId = (await openCash(s, key(), '0')).id;
  assert.equal((await products(s, '', 1, 100)).items.find((p2) => p2.id === p.id)?.onHand, 2);
  await updateBusiness(s, key(), { nif: '', tva: '', offlinePolicy: 'warning_reason' });
});
void test('fractional product creation, code and price edits, archive restoration, adjustments and returns preserve snapshots', async () => {
  const operation = key(),
    sku = key(),
    input = {
      name: 'Fabric meters',
      sku,
      category: 'Fabric',
      type: 'goods' as const,
      price: '800',
      cost: '400',
      lowStock: 0.5,
      initialQuantity: 6.125,
    };
  const p = await createProduct(s, operation, input);
  assert.deepEqual(await createProduct(s, operation, input), p);
  const sold = await finalizeSale(s, key(), {
    lines: [{ productId: p.id, quantity: 0.125 }],
    tendered: '100',
    cashSessionId,
    payment: { method: 'mobile_money', provider: 'Ecocash', reference: 'ECO-123' },
  });
  await updateProduct(s, key(), p.id, {
    name: input.name,
    sku: 'NEW-' + sku,
    category: 'Fabric',
    type: 'goods',
    price: '1200',
    cost: '0',
    lowStock: 0.5,
  });
  const receipt = await getReceipt(s, sold.id);
  assert.equal(receipt.total, '100');
  assert.equal(receipt.lines[0]?.sku, sku);
  assert.equal(receipt.lines[0]?.unitPrice, '800');
  assert.equal(receipt.payment?.reference, 'ECO-123');
  await receiveStock(s, key(), {
    productId: p.id,
    quantity: 0.5,
    unitCost: '0',
    direction: 'decrease',
    reason: 'Reviewed damaged half meter',
  });
  await receiveStock(s, key(), {
    productId: p.id,
    quantity: 0.25,
    unitCost: '400',
    direction: 'increase',
    reason: 'Reviewed quarter meter delivery',
  });
  await returnSale(s, key(), sold.id, {
    cashSessionId,
    reason: 'Partial fabric return',
    lines: [{ saleLineId: receipt.lines[0]!.id, quantity: 0.025, disposition: 'restockable' }],
  });
  assert.equal((await products(s, 'NEW-' + sku, 1, 100)).items[0]?.onHand, 5.775);
  await archiveProduct(s, key(), p.id);
  assert.equal((await products(s, 'NEW-' + sku, 1, 100)).total, 0);
  assert.equal((await products(s, 'NEW-' + sku, 1, 100, true)).total, 1);
  await restoreProduct(s, key(), p.id);
  assert.equal((await products(s, 'NEW-' + sku, 1, 100)).items[0]?.id, p.id);
  await scoped(s, 'catalog.read', async (tx) =>
    assert.equal(
      await tx.stockMovement.count({ where: { productId: p.id, sourceType: 'opening' } }),
      1,
    ),
  );
  const today = new Date().toISOString().slice(0, 10),
    report = await dashboard(s, today, today);
  assert.ok(report.topProducts.some((p) => p.quantity % 1 !== 0));
  assert.equal(report.valuationPending, true);
});
const registration = (industryId: 'hotel' | 'restaurant' = 'hotel') => ({
  industryId,
  fullName: 'Review Owner',
  companyName: 'Review lodging',
  email: `${userId}@example.test`,
  phone: '+25779123456',
  country: 'BI',
  locale: 'en' as const,
  companySize: '1-5' as const,
  primaryInterest: 'company' as const,
  demoData: false,
  acceptLegal: true as const,
});
void test('three project registration is idempotent, optional business documents stay isolated and managers can add staff without another workspace', async () => {
  const operation = key(),
    input = {
      ...registration(),
      nif: 'NIF-123',
      tva: 'TVA-456',
      documents: [
        {
          name: 'Registration.pdf',
          mime: 'application/pdf' as const,
          data: Buffer.from('%PDF-1.4\nreview fixture').toString('base64'),
        },
      ],
      projects: [
        { name: 'Review restaurant', industryId: 'restaurant' },
        { name: 'Review shop', industryId: 'other_retail' },
      ],
    };
  const result = await provisionBusiness(userId, operation, input);
  assert.deepEqual(await provisionBusiness(userId, operation, input), result);
  const all = await contexts(userId);
  assert.equal(all.filter((c) => c.businessName.startsWith('Review ')).length, 4);
  const a = { ...s, ...result },
    details = await businessDetails(a);
  assert.equal(details.business.nif, 'NIF-123');
  assert.equal(details.documents.length, 1);
  const doc = details.documents[0]!;
  assert.equal(await getDocument(s, doc.id), null);
  await assert.rejects(() => businessDetails({ ...a, userId: cashierId }), { code: 'FORBIDDEN' });
  await updateBusiness(a, key(), {
    nif: 'NIF-UPDATED',
    tva: 'TVA-456',
    offlinePolicy: 'warning_reason',
  });
  assert.equal((await businessDetails(a)).business.nif, 'NIF-UPDATED');
  await addDocument(a, key(), {
    name: 'New letter.pdf',
    mime: 'application/pdf',
    data: Buffer.from('%PDF-1.4\nnew fixture').toString('base64'),
  });
  assert.equal((await businessDetails(a)).documents.length, 2);
  const revision = await addDocument(
    a,
    key(),
    {
      name: 'Updated registration.pdf',
      mime: 'application/pdf',
      data: Buffer.from('%PDF-1.4\nupdated fixture').toString('base64'),
    },
    doc.id,
  );
  assert.equal((await getDocument(a, revision.id))?.replacesId, doc.id);
  assert.equal((await getDocument(a, doc.id))?.name, 'Registration.pdf');
  await assert.rejects(
    () =>
      addDocument(
        s,
        key(),
        {
          name: 'Wrong business.pdf',
          mime: 'application/pdf',
          data: Buffer.from('%PDF-1.4\nfixture').toString('base64'),
        },
        doc.id,
      ),
    { code: 'NOT_FOUND' },
  );

  const email = `staff-${key()}@example.test`,
    created = await addStaff(a, key(), {
      name: 'Review Staff',
      email,
      password: 'Test-only-review-password-1234',
      role: 'cashier',
    });
  const memberships = await contexts(created.id);
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0]?.businessId, result.businessId);
  assert.equal(memberships[0]?.role, 'cashier');
  assert.equal(
    ((await staff(a)) as { id: string }[]).some((r) => r.id === created.id),
    true,
  );
  const blank = await provisionBusiness(userId, key(), {
    ...registration(),
    companyName: 'Optional details skipped',
  });
  assert.equal((await businessDetails({ ...s, ...blank })).documents.length, 0);
});
void test('accommodation uses guest profiles, exact chargeable nights, scoped rooms and overlap protection', async () => {
  const business = await provisionBusiness(userId, key(), {
      ...registration(),
      companyName: 'Stay tests',
    }),
    a = { ...s, ...business };
  const room = await addRoom(a, key(), { name: 'Room 101', rate: '25000' });
  const customerId = key();
  await admin.query(
    "INSERT INTO customers(id,tenant_id,business_id,name,phone,email) VALUES($1,$2,$3,'Review guest','','')",
    [customerId, a.tenantId, a.businessId],
  );
  const input = { roomId: room.id, customerId, checkIn: '2026-10-29', checkOut: '2026-11-01' },
    operation = key();
  const stay = await addStay(a, operation, input);
  assert.equal(stay.nights, 3);
  assert.equal(stay.total, '75000');
  assert.deepEqual(await addStay(a, operation, input), stay);
  await assert.rejects(() => addStay(a, key(), { ...input, checkIn: '2026-10-30' }), {
    code: 'ROOM_UNAVAILABLE',
  });
  await addStay(a, key(), { ...input, checkIn: '2026-11-01', checkOut: '2026-11-02' });
  await assert.rejects(() => addStay(s, key(), input), { code: 'MODULE_UNAVAILABLE' });
  const overview = await rooms(a);
  assert.equal(overview.rooms.length, 1);
  assert.equal(overview.stays.length, 2);
});
void test('restaurant records food/drink, unpaid tables and atomically posts paid orders through existing checkout', async () => {
  const business = await provisionBusiness(userId, key(), {
      ...registration('restaurant'),
      companyName: 'Restaurant tests',
    }),
    a = { ...s, ...business };
  const table = await addTable(a, key(), 'Table 1'),
    p = await createProduct(a, key(), {
      name: 'Lunch',
      sku: key(),
      category: 'Menu',
      type: 'service',
      price: '10000',
      cost: '0',
      lowStock: 0,
    }),
    cash = (await openCash(a, key(), '0')).id;
  const order = await createOrder(a, key(), {
    tableId: table.id,
    lines: [{ productId: p.id, quantity: 2, kind: 'food' }],
  });
  let overview = await restaurantDashboard(a);
  assert.equal(overview.foodOrders, 1);
  assert.equal(overview.unpaid, 1);
  assert.equal(overview.activeTables, 1);
  assert.equal(overview.availableTables, 0);
  const input = {
    cashSessionId: cash,
    tendered: '20000',
    payment: {
      method: 'mobile_money' as const,
      provider: 'iHela' as const,
      reference: 'IHELA-123',
    },
  };
  const [paid, retry] = await Promise.all([
    payOrder(a, key(), order.id, input),
    payOrder(a, key(), order.id, input),
  ]);
  assert.deepEqual(paid, retry);
  overview = await restaurantDashboard(a);
  assert.equal(overview.paid, 1);
  assert.equal(overview.unpaid, 0);
  assert.equal(overview.availableTables, 1);
  assert.equal(overview.earnings, '20000');
  await admin.query("UPDATE restaurant_orders SET created_at=now()-interval '2 days' WHERE id=$1", [
    order.id,
  ]);
  const paidLater = await restaurantDashboard(a);
  assert.equal(paidLater.foodOrders, 0);
  assert.equal(paidLater.paid, 1);
  assert.equal(paidLater.earnings, '20000');
  assert.equal((await getReceipt(a, paid.id)).payment?.reference, 'IHELA-123');
  await assert.rejects(() => restaurantDashboard(s), { code: 'MODULE_UNAVAILABLE' });
});
after(async () => {
  await admin.end();
  await db.$disconnect();
  await pool.end();
});
