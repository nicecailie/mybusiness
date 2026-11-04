import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { db, pool, scoped, ownership, contexts } from '../apps/api/src/database.js';
import { createProduct, receiveStock, products } from '../apps/api/src/catalog.js';
import { finalizeSale, getReceipt, returnSale } from '../apps/api/src/sales.js';
import { openCash, closeCash, cashSession } from '../apps/api/src/cash.js';
import { dashboard } from '../apps/api/src/reporting.js';
import type { Scope } from '../packages/contracts/src/index.js';
if (process.env.ALLOW_DEMO_SEED !== 'true')
  throw new Error('Integration tests require an isolated development database.');
const admin = new Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
const tenantA = randomUUID(),
  tenantB = randomUUID(),
  businessA = randomUUID(),
  businessB = randomUUID(),
  branchA = randomUUID(),
  branchB = randomUUID(),
  branchOther = randomUUID(),
  userId = randomUUID(),
  cashierId = randomUUID();
let s: Scope, registerId: string;
const operation = () => randomUUID();
async function newProduct(quantity = 10, price = '15000', cost = '10000') {
  const product = await createProduct(s, operation(), {
    name: 'Integration product',
    sku: randomUUID(),
    category: 'Tests',
    type: 'goods',
    price,
    cost,
    lowStock: 1,
  });
  if (quantity)
    await receiveStock(s, operation(), {
      productId: product.id,
      quantity,
      unitCost: cost,
      reason: 'Integration test opening',
    });
  return product.id;
}
before(async () => {
  const roles = await admin.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='mybusiness_app'",
  );
  assert.equal(roles.rows[0]?.rolsuper, false);
  assert.equal(roles.rows[0]?.rolbypassrls, false);
  for (const [id, email] of [
    [userId, `${userId}@example.test`],
    [cashierId, `${cashierId}@example.test`],
  ])
    await admin.query(
      'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,\'Test actor\',$2,true,now(),now())',
      [id, email],
    );
  for (const [tenant, business, branch] of [
    [tenantA, businessA, branchA],
    [tenantB, businessB, branchB],
  ]) {
    await admin.query("INSERT INTO tenants(id,name,demo) VALUES($1,'Integration tenant',true)", [
      tenant,
    ]);
    await admin.query(
      "INSERT INTO businesses(id,tenant_id,name) VALUES($1,$2,'Integration business')",
      [business, tenant],
    );
    await admin.query(
      "INSERT INTO branches(id,tenant_id,business_id,name) VALUES($1,$2,$3,'Integration branch')",
      [branch, tenant, business],
    );
  }
  await admin.query(
    "INSERT INTO branches(id,tenant_id,business_id,name) VALUES($1,$2,$3,'Restricted branch')",
    [branchOther, tenantA, businessA],
  );
  for (const [actor, role] of [
    [userId, 'owner'],
    [cashierId, 'cashier'],
  ])
    await admin.query(
      'INSERT INTO memberships(id,user_id,tenant_id,business_id,branch_id,role) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), actor, tenantA, businessA, branchA, role],
    );
  s = {
    userId,
    tenantId: tenantA,
    businessId: businessA,
    branchId: branchA,
    role: 'owner',
    requestId: randomUUID(),
  };
  registerId = (await openCash(s, operation(), '50000')).id;
});
void test('runtime role is denied data without tenant context', async () => {
  assert.equal((await db.product.findMany()).length, 0);
  assert.equal((await db.sale.findMany()).length, 0);
});
void test('guessed tenant and branch IDs fail authorization and context discovery is scoped', async () => {
  await assert.rejects(
    () =>
      products({ ...s, tenantId: tenantB, businessId: businessB, branchId: branchB }, '', 1, 30),
    { code: 'FORBIDDEN' },
  );
  await assert.rejects(() => products({ ...s, branchId: branchOther }, '', 1, 30), {
    code: 'FORBIDDEN',
  });
  assert.equal((await contexts(userId)).length, 1);
});
void test('runtime RLS hides foreign products even with a guessed primary key', async () => {
  const id = randomUUID();
  await admin.query(
    "INSERT INTO products(id,tenant_id,business_id,name,sku,category,price,low_stock) VALUES($1,$2,$3,'Foreign','FOREIGN','Tests',1,1)",
    [id, tenantB, businessB],
  );
  await scoped(s, 'catalog.read', async (tx) => {
    assert.equal(await tx.product.findUnique({ where: { id } }), null);
    await assert.rejects(() =>
      tx.customer.create({
        data: {
          id: randomUUID(),
          tenantId: tenantB,
          businessId: businessB,
          name: 'Foreign',
          phone: '',
          email: '',
        },
      }),
    );
  });
});
void test('cashier cannot refund and revoked membership cannot write even with owner role supplied', async () => {
  await assert.rejects(
    () =>
      returnSale({ ...s, userId: cashierId, role: 'owner' }, operation(), randomUUID(), {
        lines: [],
        reason: 'test',
        cashSessionId: registerId,
      }),
    { code: 'FORBIDDEN' },
  );
  await admin.query('UPDATE memberships SET active=false WHERE user_id=$1', [cashierId]);
  await assert.rejects(
    () =>
      createProduct({ ...s, userId: cashierId }, operation(), {
        name: 'Denied',
        sku: 'Denied',
        category: 'Test',
        price: '1',
        cost: '0',
        lowStock: 1,
        type: 'goods',
      }),
    { code: 'FORBIDDEN' },
  );
});
void test('retry after commit and parallel identical commands create one financial effect', async () => {
  const productId = await newProduct(),
    key = operation(),
    input = {
      lines: [{ productId, quantity: 2 }],
      tendered: '50000',
      cashSessionId: registerId,
    };
  const [first, retry] = await Promise.all([
    finalizeSale(s, key, input),
    finalizeSale(s, key, input),
  ]);
  assert.equal(first.id, retry.id);
  const r = await getReceipt(s, first.id);
  assert.equal(r.total, '30000');
  assert.equal(r.change, '20000');
  await scoped(s, 'journal.read', async (tx) => {
    assert.equal(await tx.payment.count({ where: { saleId: r.id } }), 1);
    assert.equal(await tx.stockMovement.count({ where: { sourceId: r.id } }), 1);
    assert.equal(await tx.journal.count({ where: { sourceId: r.id } }), 1);
    assert.equal(Number((await tx.stockBalance.findFirst({ where: { productId } }))?.onHand), 8);
  });
  await assert.rejects(() => finalizeSale(s, key, { ...input, tendered: '60000' }), {
    code: 'IDEMPOTENCY_CONFLICT',
  });
});
void test('two sales of the final unit cannot both succeed', async () => {
  const productId = await newProduct(1);
  const input = {
    lines: [{ productId, quantity: 1 }],
    tendered: '15000',
    cashSessionId: registerId,
  };
  const results = await Promise.allSettled([
    finalizeSale(s, operation(), input),
    finalizeSale(s, operation(), input),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  await scoped(s, 'stock.receive', async (tx) =>
    assert.equal(Number((await tx.stockBalance.findFirst({ where: { productId } }))?.onHand), 0),
  );
});
void test('partial return is idempotent, original snapshots remain and over-return is rejected', async () => {
  const productId = await newProduct(20),
    sale = await finalizeSale(s, operation(), {
      lines: [{ productId, quantity: 2 }],
      tendered: '30000',
      cashSessionId: registerId,
    }),
    r = await getReceipt(s, sale.id),
    saleLineId = r.lines[0]!.id,
    key = operation();
  const data = {
    lines: [{ saleLineId, quantity: 1, disposition: 'restockable' as const }],
    reason: 'Customer returned one unit',
    cashSessionId: registerId,
  };
  const first = await returnSale(s, key, r.id, data),
    retry = await returnSale(s, key, r.id, data);
  assert.equal(first.id, retry.id);
  assert.equal(first.total, '15000');
  assert.equal((await getReceipt(s, r.id)).lines[0]?.returned, 1);
  await assert.rejects(
    () =>
      returnSale(s, operation(), r.id, {
        ...data,
        lines: [{ saleLineId, quantity: 2, disposition: 'restockable' }],
      }),
    { code: 'RETURN_EXCEEDS_SALE' },
  );
  await scoped(s, 'journal.read', async (tx) => {
    assert.equal(Number((await tx.stockBalance.findFirst({ where: { productId } }))?.onHand), 19);
    assert.equal(
      (await tx.stockBalance.findFirst({ where: { productId } }))?.value.toString(),
      '190000',
    );
    assert.equal((await tx.sale.findUnique({ where: { id: r.id } }))?.total.toString(), '30000');
  });
});
void test('damaged returns never replenish sellable stock and ledger still balances', async () => {
  const productId = await newProduct(2),
    sale = await finalizeSale(s, operation(), {
      lines: [{ productId, quantity: 1 }],
      tendered: '15000',
      cashSessionId: registerId,
    }),
    r = await getReceipt(s, sale.id);
  const returned = await returnSale(s, operation(), r.id, {
    lines: [{ saleLineId: r.lines[0]!.id, quantity: 1, disposition: 'damaged' }],
    reason: 'Damaged packaging',
    cashSessionId: registerId,
  });
  await scoped(s, 'journal.read', async (tx) => {
    assert.equal(Number((await tx.stockBalance.findFirst({ where: { productId } }))?.onHand), 1);
    const j = await tx.journal.findFirstOrThrow({
        where: { sourceId: returned.id },
      }),
      lines = await tx.journalLine.findMany({ where: { journalId: j.id } });
    assert.ok(lines.some((l) => l.account === '5100 Damaged goods'));
    assert.equal(
      lines.reduce((n, l) => n + BigInt(l.debit.toString()) - BigInt(l.credit.toString()), 0n),
      0n,
    );
  });
});
void test('database rejects an unbalanced journal and posted records cannot be edited', async () => {
  await assert.rejects(() =>
    scoped(s, 'journal.read', async (tx) => {
      const id = randomUUID();
      await tx.journal.create({
        data: {
          id,
          ...ownership(s),
          sourceType: 'test',
          sourceId: randomUUID(),
        },
      });
      await tx.journalLine.createMany({
        data: [
          {
            id: randomUUID(),
            ...ownership(s),
            journalId: id,
            account: 'Cash',
            debit: '1',
            credit: '0',
          },
          {
            id: randomUUID(),
            ...ownership(s),
            journalId: id,
            account: 'Sales',
            debit: '0',
            credit: '2',
          },
        ],
      });
    }),
  );
  await assert.rejects(() =>
    scoped(s, 'journal.read', async (tx) => {
      await tx.sale.updateMany({ data: { total: '1' } });
    }),
  );
});
void test('closed period rolls back stock, payment, document and journal', async () => {
  const productId = await newProduct(1);
  await admin.query(
    "INSERT INTO periods(id,tenant_id,business_id,through_date) VALUES($1,$2,$3,'2999-12-31')",
    [randomUUID(), tenantA, businessA],
  );
  try {
    await assert.rejects(
      () =>
        finalizeSale(s, operation(), {
          lines: [{ productId, quantity: 1 }],
          tendered: '15000',
          cashSessionId: registerId,
        }),
      { code: 'PERIOD_CLOSED' },
    );
    await scoped(s, 'stock.receive', async (tx) =>
      assert.equal(Number((await tx.stockBalance.findFirst({ where: { productId } }))?.onHand), 1),
    );
  } finally {
    await admin.query('DELETE FROM periods WHERE tenant_id=$1', [tenantA]);
  }
});
void test('report reconciles to source records and register variance locks the session', async () => {
  const d = await dashboard(s, '2026-01-01', '2026-12-31');
  await scoped(s, 'journal.read', async (tx) => {
    const sales = await tx.sale.aggregate({ _sum: { total: true } }),
      returns = await tx.return.aggregate({ _sum: { total: true } });
    assert.equal(
      d.netSales,
      (
        BigInt(sales._sum.total?.toString() ?? '0') - BigInt(returns._sum.total?.toString() ?? '0')
      ).toString(),
    );
    const balances = await tx.stockBalance.findMany();
    for (const b of balances) {
      const movements = await tx.stockMovement.findMany({
        where: { productId: b.productId },
      });
      assert.equal(
        movements.reduce((n, m) => n + Number(m.quantity), 0),
        Number(b.onHand),
      );
      assert.equal(
        movements.reduce((n, m) => n + BigInt(m.value.toString()), 0n).toString(),
        b.value.toString(),
      );
    }
  });
  const session = await cashSession(s);
  assert.ok(session);
  const close = await closeCash(
    s,
    operation(),
    registerId,
    (BigInt(session.expected) - 1000n).toString(),
    'Counted shortage',
  );
  assert.equal(close.variance, '-1000');
  await assert.rejects(
    () =>
      finalizeSale(s, operation(), {
        lines: [{ productId: randomUUID(), quantity: 1 }],
        tendered: '1',
        cashSessionId: registerId,
      }),
    { code: 'CASH_SESSION_CLOSED' },
  );
});
after(async () => {
  await admin.end();
  await db.$disconnect();
  await pool.end();
});
