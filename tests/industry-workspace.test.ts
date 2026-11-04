import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Scope } from '../packages/contracts/src/index.js';
import { db, pool, scoped, write } from '../apps/api/src/database.js';
import { createProduct, products } from '../apps/api/src/catalog.js';
import {
  receivePurchase,
  createCategory,
  createExpense,
  reverseExpense,
  financialReport,
} from '../apps/api/src/core.js';
import {
  enterPurchase,
  receiveAndBill,
  payPurchase,
  purchaseWorkspace,
} from '../apps/api/src/purchasing.js';
import { provisionBusiness } from '../apps/api/src/onboarding.js';
import { businessDetailsSchema } from '../packages/contracts/src/index.js';
import { workspaceLinks, hasEffectiveModule } from '../packages/domain/src/industries.js';
import { can } from '../packages/domain/src/index.js';
import { moneyOverview } from '../apps/api/src/money.js';
if (process.env.ALLOW_DEMO_SEED !== 'true') throw new Error('Use an isolated demo database.');
const admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL }),
  id = () => randomUUID(),
  tenant = id(),
  business = id(),
  branch = id(),
  otherBranch = id(),
  owner = id(),
  stockActor = id(),
  cashier = id(),
  purchaser = id();
const scope: Scope = {
  tenantId: tenant,
  businessId: business,
  branchId: branch,
  userId: owner,
  role: 'viewer',
  requestId: id(),
};
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Bujumbura',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const obj = (v: unknown) => v as Record<string, unknown>,
  items = (v: unknown) => obj(v).items as Record<string, unknown>[];
let productId: string, orderId: string, lineId: string;
before(async () => {
  for (const actor of [owner, stockActor, cashier, purchaser])
    await admin.query(
      'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',
      [actor, 'Industry test', actor + '@example.test'],
    );
  await admin.query("INSERT INTO tenants(id,name,demo) VALUES($1,'Industry test',true)", [tenant]);
  await admin.query(
    "INSERT INTO businesses(id,tenant_id,name,industry_id) VALUES($1,$2,'Industry test','other_retail')",
    [business, tenant],
  );
  for (const br of [branch, otherBranch])
    await admin.query(
      "INSERT INTO branches(id,tenant_id,business_id,name) VALUES($1,$2,$3,'Industry branch')",
      [br, tenant, business],
    );
  for (const [actor, role] of [
    [owner, 'owner'],
    [stockActor, 'inventory'],
    [cashier, 'cashier'],
    [purchaser, 'purchasing'],
  ])
    await admin.query(
      'INSERT INTO memberships(id,user_id,tenant_id,business_id,branch_id,role) VALUES($1,$2,$3,$4,$5,$6)',
      [id(), actor, tenant, business, branch, role],
    );
  productId = (
    await createProduct(scope, id(), {
      name: 'Phase A product',
      sku: id(),
      category: 'Tests',
      price: '200',
      cost: '0',
      lowStock: 1,
      type: 'goods',
    })
  ).id;
});
void test('A: one save creates inline supplier and ordered purchase exactly once', async () => {
  const key = id(),
    input = {
      supplier: { name: 'Inline supplier' },
      mode: 'order',
      orderDate: today,
      lines: [{ productId, quantity: 10, unitCost: '100' }],
    };
  const [first, retry] = await Promise.all([
    enterPurchase(scope, key, input),
    enterPurchase(scope, key, input),
  ]);
  assert.equal(first.id, retry.id);
  orderId = first.id;
  const row = items(await purchaseWorkspace(scope))[0]!;
  assert.equal(row.status, 'ordered');
  assert.equal(row.orderedQuantity, '10000');
  assert.equal(row.receivedQuantity, '0');
  lineId = String((row.lines as Record<string, unknown>[])[0]!.id);
  assert.equal(
    (await admin.query('SELECT id FROM suppliers WHERE business_id=$1', [business])).rowCount,
    1,
  );
});
void test('A: partial receipt automatically creates one bill and balanced stock/AP entries on concurrent retry', async () => {
  const key = id(),
    input = { lines: [{ lineId, quantity: 4 }] };
  const [first, retry] = await Promise.all([
    receiveAndBill(scope, key, orderId, input),
    receiveAndBill(scope, key, orderId, input),
  ]);
  assert.equal(first.id, retry.id);
  const bill = await admin.query(
    'SELECT total::text,paid::text FROM supplier_bills WHERE business_id=$1',
    [business],
  );
  assert.equal(bill.rowCount, 1);
  assert.equal(bill.rows[0].total, '400');
  const balances = await admin.query(
    'SELECT account,sum(debit-credit)::text AS balance FROM journal_lines WHERE business_id=$1 GROUP BY account',
    [business],
  );
  assert.equal(
    balances.rows.find((r) => r.account === '2100 Goods received not billed').balance,
    '0',
  );
  assert.equal(balances.rows.find((r) => r.account === '2000 Accounts payable').balance, '-400');
  assert.equal((await products(scope, '', 1, 30)).items[0]!.onHand, 4);
});
void test('A: partial and full purchase payments allocate existing bills with one effect and correct row balances', async () => {
  const key = id(),
    payment = { amount: '100', account: '1000 Cash', reference: 'Part payment' };
  const [a, b] = await Promise.all([
    payPurchase(scope, key, orderId, payment),
    payPurchase(scope, key, orderId, payment),
  ]);
  assert.deepEqual(a, b);
  let row = items(await purchaseWorkspace(scope))[0]!;
  assert.equal(row.paid, '100');
  assert.equal(row.owed, '300');
  assert.equal(row.supplierOwed, '300');
  await payPurchase(scope, id(), orderId, { account: '1000 Cash', reference: 'Pay remaining' });
  row = items(await purchaseWorkspace(scope))[0]!;
  assert.equal(row.owed, '0');
  assert.equal(row.paid, '400');
  await assert.rejects(
    () =>
      payPurchase(scope, id(), orderId, { amount: '1', account: '1000 Cash', reference: 'Extra' }),
    { code: 'INVALID_PAYMENT' },
  );
});
void test('A: inventory can receive remaining stock and auto-bill without permission to pay or read owed amounts', async () => {
  const stock = { ...scope, userId: stockActor };
  await receiveAndBill(stock, id(), orderId, { lines: [{ lineId, quantity: 6 }] });
  const row = items(await purchaseWorkspace(stock))[0]!;
  assert.equal(row.status, 'received');
  assert.equal(row.paid, null);
  assert.equal(row.owed, null);
  assert.equal(
    (obj(await purchaseWorkspace(stock)).suppliers as Record<string, unknown>[])[0]!.phone,
    undefined,
  );
  await assert.rejects(
    () => payPurchase(stock, id(), orderId, { account: '1000 Cash', reference: 'Denied' }),
    { code: 'FORBIDDEN' },
  );
  await payPurchase(scope, id(), orderId, { account: '1000 Cash', reference: 'Final receipt' });
  const full = items(await purchaseWorkspace(scope))[0]!;
  assert.equal(full.paid, '1000');
  assert.equal(full.owed, '0');
  await assert.rejects(
    () => receiveAndBill(stock, id(), orderId, { lines: [{ lineId, quantity: 1 }] }),
    { code: 'INVALID_STATE' },
  );
});
void test('A: money separates purchase stock, equipment assets, running costs and cash movements', async () => {
  const equipment = (
      await createCategory(scope, id(), { name: 'Equipment test ' + id(), kind: 'equipment' })
    ).id,
    running = (await createCategory(scope, id(), { name: 'Running test ' + id(), kind: 'running' }))
      .id,
    other = (await createCategory(scope, id(), { name: 'Other test ' + id(), kind: 'other' })).id;
  const asset = (
    await createExpense(scope, id(), {
      categoryId: equipment,
      expenseDate: today,
      amount: '10000',
      account: '1000 Cash',
      description: 'Equipment purchase',
    })
  ).id;
  await createExpense(scope, id(), {
    categoryId: running,
    expenseDate: today,
    amount: '50',
    account: '1000 Cash',
    description: 'Running cost',
  });
  await createExpense(scope, id(), {
    categoryId: other,
    expenseDate: today,
    amount: '10',
    account: '1000 Cash',
    description: 'Other cost',
  });
  const money = obj(await moneyOverview(scope, today, today)),
    metrics = obj(money.metrics),
    costs = obj(money.costsByType);
  assert.equal(metrics.runningCosts, '60');
  assert.equal(metrics.profitAfterCosts, '-60');
  assert.equal(metrics.stockValue, '1000');
  assert.equal(metrics.cashOut, '11060');
  assert.equal(metrics.suppliersOwed, '0');
  assert.equal(costs.equipment, '10000');
  assert.equal(costs.purchase, '1000');
  await admin.query("UPDATE expense_categories SET kind='running' WHERE id=$1", [equipment]);
  await reverseExpense(scope, id(), asset, 'Return of equipment');
  const after = obj(await moneyOverview(scope, today, today));
  assert.equal(obj(after.costsByType).equipment, '0');
  assert.equal(obj(after.metrics).runningCosts, '60');
  assert.equal(obj(after.metrics).cashIn, '10000');
  assert.equal(obj(await financialReport(scope, today, today)).expenses, '60');
});
void test('A: category defaults exist for a new business and snapshots preserve original cost classification', async () => {
  const rows = await admin.query(
    'SELECT kind,system_key FROM expense_categories WHERE business_id=$1 AND system_key IS NOT NULL',
    [business],
  );
  assert.equal(rows.rowCount, 4);
  assert.ok(rows.rows.some((r) => r.kind === 'equipment'));
  await scoped(scope, 'expense.read', async (tx) =>
    assert.equal(
      (await tx.expense.findMany({ where: { postingAccount: '1500 Equipment' } })).length,
      1,
    ),
  );
});
void test('A: cashier, foreign branch and forged role cannot access purchases or money', async () => {
  await assert.rejects(() => purchaseWorkspace({ ...scope, userId: cashier, role: 'owner' }), {
    code: 'FORBIDDEN',
  });
  await assert.rejects(() => moneyOverview({ ...scope, userId: cashier }, today, today), {
    code: 'FORBIDDEN',
  });
  await assert.rejects(
    () =>
      receiveAndBill({ ...scope, branchId: otherBranch }, id(), orderId, {
        lines: [{ lineId, quantity: 1 }],
      }),
    { code: 'FORBIDDEN' },
  );
  await assert.rejects(() => moneyOverview({ ...scope, userId: purchaser }, today, today), {
    code: 'FORBIDDEN',
  });
});
void test('A: failed entry rolls inline supplier back and closed period rolls auto-bill/receipt/stock back', async () => {
  const count = await admin.query('SELECT count(*) FROM suppliers WHERE business_id=$1', [
    business,
  ]);
  await assert.rejects(() =>
    enterPurchase(scope, id(), {
      supplier: { name: 'Rolled back supplier' },
      mode: 'order',
      orderDate: today,
      lines: [{ productId: id(), quantity: 1, unitCost: '1' }],
    }),
  );
  assert.equal(
    (await admin.query('SELECT count(*) FROM suppliers WHERE business_id=$1', [business])).rows[0]
      .count,
    count.rows[0].count,
  );
  const supplierId = String(items(await purchaseWorkspace(scope))[0]!.supplierId),
    order = (
      await enterPurchase(scope, id(), {
        supplierId,
        mode: 'order',
        orderDate: today,
        lines: [{ productId, quantity: 1, unitCost: '100' }],
      })
    ).id;
  const row = items(await purchaseWorkspace(scope, 1, '', order))[0]!,
    line = String((row.lines as Record<string, unknown>[])[0]!.id),
    before = (await products(scope, '', 1, 30)).items[0]!.onHand;
  const period = id();
  await admin.query(
    'INSERT INTO periods(id,tenant_id,business_id,through_date) VALUES($1,$2,$3,$4)',
    [period, tenant, business, today],
  );
  try {
    await assert.rejects(
      () => receiveAndBill(scope, id(), order, { lines: [{ lineId: line, quantity: 1 }] }),
      { code: 'PERIOD_CLOSED' },
    );
  } finally {
    await admin.query('DELETE FROM periods WHERE id=$1', [period]);
  }
  assert.equal((await products(scope, '', 1, 30)).items[0]!.onHand, before);
  assert.equal(
    (await admin.query('SELECT id FROM goods_receipts WHERE order_id=$1', [order])).rowCount,
    0,
  );
});

void test('A: navigation is the industry/role intersection and new owners keep their provisioned industry', async () => {
  const cashierLinks = workspaceLinks('cashier', 'restaurant', (p) => can('cashier', p));
  assert.ok(cashierLinks.some((l) => l.page === 'sell'));
  assert.ok(
    !cashierLinks.some((l) => l.page === 'money' || l.page === 'purchases' || l.page === 'team'),
  );
  const property = workspaceLinks('owner', 'real_estate_agency', (p) => can('owner', p));
  assert.ok(!property.some((l) => l.page === 'sell' || l.page === 'purchases'));
  assert.ok(property.some((l) => l.page === 'money'));
  assert.ok(hasEffectiveModule('other_retail', 'invoicing'));
  const provisioned = await provisionBusiness(owner, id(), {
    industryId: 'grocery_store',
    fullName: 'Industry owner',
    companyName: 'Workspace grocery',
    email: owner + '@example.test',
    phone: '+25779000000',
    country: 'BI',
    locale: 'en',
    companySize: '1-5',
    primaryInterest: 'company',
    demoData: false,
    acceptLegal: true,
  });
  const result = await admin.query('SELECT industry_id FROM businesses WHERE id=$1', [
    provisioned.businessId,
  ]);
  assert.equal(result.rows[0].industry_id, 'grocery_store');
  assert.ok(
    workspaceLinks('owner', provisioned.industryId, (p) => can('owner', p)).some(
      (l) => l.page === 'purchases',
    ),
  );
  assert.equal(
    businessDetailsSchema.safeParse({
      nif: '',
      tva: '',
      offlinePolicy: 'warning_reason',
      industryId: 'hotel',
    }).success,
    false,
  );
});

void test('A: legacy unbilled receipts stay in supplier owed totals and can be paid without manual billing', async () => {
  const supplierId = String(items(await purchaseWorkspace(scope))[0]!.supplierId),
    order = (
      await enterPurchase(scope, id(), {
        supplierId,
        mode: 'order',
        orderDate: today,
        lines: [{ productId, quantity: 1, unitCost: '100' }],
      })
    ).id;
  const row = items(await purchaseWorkspace(scope, 1, '', order))[0]!,
    line = String((row.lines as Record<string, unknown>[])[0]!.id);
  await receivePurchase(scope, id(), order, { lines: [{ lineId: line, quantity: 1 }] });
  assert.equal(items(await purchaseWorkspace(scope, 1, '', order))[0]!.supplierOwed, '100');
  assert.equal(obj(obj(await moneyOverview(scope, today, today)).metrics).suppliersOwed, '100');
  await payPurchase(scope, id(), order, {
    account: '1010 Bank',
    reference: 'Legacy received goods',
  });
  assert.equal(items(await purchaseWorkspace(scope, 1, '', order))[0]!.supplierOwed, '0');
});

void test('A: retrying a pre-upgrade category command retains its original idempotency fingerprint', async () => {
  const key = id(),
    name = 'Legacy category ' + id(),
    categoryId = id();
  await write(scope, 'expense.create', 'expense.category', key, { name }, async (tx, a) => {
    await tx.expenseCategory.create({
      data: { id: categoryId, tenantId: a.tenantId, businessId: a.businessId, name },
    });
    return { id: categoryId };
  });
  assert.equal((await createCategory(scope, key, { name })).id, categoryId);
});
after(async () => {
  await admin.end();
  await db.$disconnect();
  await pool.end();
});
