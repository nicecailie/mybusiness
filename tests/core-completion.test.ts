import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { db, pool, scoped } from '../apps/api/src/database.js';
import * as core from '../apps/api/src/core.js';
import { createProduct, products, createCustomer } from '../apps/api/src/catalog.js';
import { openCash } from '../apps/api/src/cash.js';
import { finalizeSale, getReceipt, returnSale } from '../apps/api/src/sales.js';
import type { Scope } from '../packages/contracts/src/index.js';
if (process.env.ALLOW_DEMO_SEED !== 'true')
  throw new Error('Use an isolated development database.');
const admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const key = () => randomUUID(),
  tenant = key(),
  business = key(),
  branch = key(),
  destination = key(),
  foreignTenant = key(),
  foreignBusiness = key(),
  foreignBranch = key(),
  user = key(),
  cashier = key(),
  inventory = key(),
  accountant = key();
const s: Scope = {
  userId: user,
  tenantId: tenant,
  businessId: business,
  branchId: branch,
  role: 'viewer',
  requestId: key(),
};
const dest = { ...s, branchId: destination };
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Bujumbura',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
let supplierId: string,
  productId: string,
  orderId: string,
  lineId: string,
  receiptId: string,
  billId: string,
  customerId: string,
  invoiceId: string,
  registerId: string;
const object = (v: unknown) => v as Record<string, unknown>;
const records = (v: unknown) => object(v).items as Record<string, unknown>[];
async function stock(scope = s) {
  return scoped(scope, 'catalog.read', async (tx) => {
    const b = await tx.stockBalance.findFirst({ where: { productId } });
    return { quantity: Number(b?.onHand ?? 0), value: b?.value.toString() ?? '0' };
  });
}
before(async () => {
  for (const id of [user, cashier, inventory, accountant])
    await admin.query(
      'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,\'Core test\',$2,true,now(),now())',
      [id, id + '@example.test'],
    );
  for (const [t, b, br] of [
    [tenant, business, branch],
    [foreignTenant, foreignBusiness, foreignBranch],
  ]) {
    await admin.query("INSERT INTO tenants(id,name,demo) VALUES($1,'Core tests',true)", [t]);
    await admin.query("INSERT INTO businesses(id,tenant_id,name) VALUES($1,$2,'Core business')", [
      b,
      t,
    ]);
    await admin.query(
      "INSERT INTO branches(id,tenant_id,business_id,name) VALUES($1,$2,$3,'Core branch')",
      [br, t, b],
    );
  }
  await admin.query(
    "INSERT INTO branches(id,tenant_id,business_id,name) VALUES($1,$2,$3,'Destination')",
    [destination, tenant, business],
  );
  for (const [actor, role, br] of [
    [user, 'owner', branch],
    [user, 'owner', destination],
    [cashier, 'cashier', branch],
    [inventory, 'inventory', branch],
    [inventory, 'inventory', destination],
    [accountant, 'accountant', branch],
  ])
    await admin.query(
      'INSERT INTO memberships(id,user_id,tenant_id,business_id,branch_id,role) VALUES($1,$2,$3,$4,$5,$6)',
      [key(), actor, tenant, business, br, role],
    );
  productId = (
    await createProduct(s, key(), {
      name: 'Core stock',
      sku: key(),
      category: 'Tests',
      type: 'goods',
      price: '200',
      cost: '0',
      lowStock: 1,
    })
  ).id;
  customerId = (await createCustomer(s, key(), { name: 'Credit customer', phone: '', email: '' }))
    .id;
  registerId = (await openCash(s, key(), '0')).id;
});
void test('supplier creation is validated, idempotent, editable and business scoped', async () => {
  const operation = key(),
    input = { name: 'Core supplier', email: 'supplier@example.test' };
  const first = await core.saveSupplier(s, operation, input),
    retry = await core.saveSupplier(s, operation, input);
  supplierId = first.id;
  assert.equal(first.id, retry.id);
  await core.saveSupplier(s, key(), { name: 'Core supplier updated', active: true }, supplierId);
  assert.equal(
    object(object(await core.supplierDetail(s, supplierId)).supplier).name,
    'Core supplier updated',
  );
  assert.throws(() => core.saveSupplier(s, key(), { name: 'X', email: 'bad' }));
});
void test('purchase draft, editing and order submission retain lines and scope', async () => {
  const input = {
    supplierId,
    orderDate: today,
    lines: [{ productId, quantity: 10, unitCost: '100' }],
  };
  orderId = (await core.savePurchase(s, key(), input)).id;
  await core.savePurchase(s, key(), input, orderId);
  lineId = String(
    (object(await core.purchaseDetail(s, orderId)).lines as Record<string, unknown>[])[0]!.id,
  );
  await core.purchaseAction(s, key(), orderId, 'order');
  await assert.rejects(() => core.savePurchase(s, key(), input, orderId), {
    code: 'INVALID_STATE',
  });
});
void test('partial receiving and concurrent retry increase inventory exactly once', async () => {
  const operation = key(),
    input = { lines: [{ lineId, quantity: 4 }] };
  const [a, b] = await Promise.all([
    core.receivePurchase(s, operation, orderId, input),
    core.receivePurchase(s, operation, orderId, input),
  ]);
  assert.equal(a.id, b.id);
  receiptId = a.id;
  assert.deepEqual(await stock(), { quantity: 4, value: '400' });
  assert.equal(
    object(object(await core.purchaseDetail(s, orderId)).order).status,
    'partially_received',
  );
  await assert.rejects(
    () => core.receivePurchase(s, key(), orderId, { lines: [{ lineId, quantity: 7 }] }),
    { code: 'INVALID_STATE' },
  );
});
void test('remaining receipt exhausts the order and duplicate receiving with a new key is rejected', async () => {
  await core.receivePurchase(s, key(), orderId, { lines: [{ lineId, quantity: 6 }] });
  assert.deepEqual(await stock(), { quantity: 10, value: '1000' });
  await assert.rejects(
    () => core.receivePurchase(s, key(), orderId, { lines: [{ lineId, quantity: 1 }] }),
    { code: 'INVALID_STATE' },
  );
});
void test('purchase costing feeds existing weighted average and future COGS', async () => {
  const order = (
    await core.savePurchase(s, key(), {
      supplierId,
      orderDate: today,
      lines: [{ productId, quantity: 10, unitCost: '200' }],
    })
  ).id;
  await core.purchaseAction(s, key(), order, 'order');
  const line = String(
    (object(await core.purchaseDetail(s, order)).lines as Record<string, unknown>[])[0]!.id,
  );
  await core.receivePurchase(s, key(), order, { lines: [{ lineId: line, quantity: 10 }] });
  assert.deepEqual(await stock(), { quantity: 20, value: '3000' });
});
void test('supplier bill is tied to a single receipt and partial payment reduces payable', async () => {
  billId = (
    await core.createBill(s, key(), {
      receiptId,
      reference: 'SUP-' + key(),
      billDate: today,
      dueDate: today,
    })
  ).id;
  const operation = key(),
    payment = { amount: '150', account: '1010 Bank', reference: 'bank-test' };
  await core.settle(s, operation, billId, payment, 'bill');
  await core.settle(s, operation, billId, payment, 'bill');
  const bill = records(await core.payables(s)).find((b) => b.id === billId)!;
  assert.equal(bill.total, '400');
  assert.equal(bill.paid, '150');
  assert.equal(bill.displayStatus, 'partially_paid');
  await assert.rejects(() => core.settle(s, key(), billId, { ...payment, amount: '251' }, 'bill'), {
    code: 'INVALID_STATE',
  });
  await assert.rejects(() =>
    core.createBill(s, key(), { receiptId, reference: key(), billDate: today, dueDate: today }),
  );
});
void test('expenses post, reverse once and change authoritative profit', async () => {
  const categoryId = (await core.createCategory(s, key(), { name: 'Rent ' + key() })).id;
  const id = (
    await core.createExpense(s, key(), {
      categoryId,
      expenseDate: today,
      amount: '50',
      account: '1010 Bank',
      description: 'Office rent',
    })
  ).id;
  assert.equal(object(await core.financialReport(s, today, today)).expenses, '50');
  await core.reverseExpense(s, key(), id, 'Correction of duplicate expense');
  assert.equal(object(await core.financialReport(s, today, today)).expenses, '0');
  await assert.rejects(() => core.reverseExpense(s, key(), id, 'Again'), { code: 'INVALID_STATE' });
  await core.createExpense(s, key(), {
    categoryId,
    expenseDate: today,
    amount: '50',
    account: '1010 Bank',
    description: 'Correct rent',
  });
});
void test('draft credit invoice does not move stock; issue posts stock, AR and COGS once', async () => {
  invoiceId = (
    await core.createInvoice(s, key(), {
      customerId,
      invoiceDate: today,
      dueDate: today,
      lines: [{ productId, quantity: 2, unitPrice: '200' }],
    })
  ).id;
  assert.deepEqual(await stock(), { quantity: 20, value: '3000' });
  const operation = key();
  await Promise.all([
    core.issueInvoice(s, operation, invoiceId),
    core.issueInvoice(s, operation, invoiceId),
  ]);
  assert.deepEqual(await stock(), { quantity: 18, value: '2700' });
  await assert.rejects(() => core.issueInvoice(s, key(), invoiceId), { code: 'INVALID_STATE' });
});
void test('customer partial payment and receivable history reconcile', async () => {
  await core.settle(
    s,
    key(),
    invoiceId,
    { amount: '100', account: '1010 Bank', reference: 'Customer bank receipt' },
    'invoice',
  );
  const detail = object(await core.customerBalance(s, customerId));
  assert.equal(detail.balance, '300');
  assert.equal((detail.payments as unknown[]).length, 1);
  await assert.rejects(
    () =>
      core.settle(
        s,
        key(),
        invoiceId,
        { amount: '301', account: '1010 Bank', reference: 'Overpayment' },
        'invoice',
      ),
    { code: 'INVALID_STATE' },
  );
});
void test('transfer in transit and destination receipt preserve quantity/value; cannot receive twice', async () => {
  const id = (
    await core.createTransfer(s, key(), {
      destinationId: destination,
      lines: [{ productId, quantity: 3 }],
    })
  ).id;
  await core.transferAction(s, key(), id, 'send');
  assert.deepEqual(await stock(), { quantity: 15, value: '2250' });
  assert.deepEqual(await stock(dest), { quantity: 0, value: '0' });
  await assert.rejects(() => core.transferAction(s, key(), id, 'receive'), {
    code: 'INVALID_STATE',
  });
  await core.transferAction(dest, key(), id, 'receive');
  assert.deepEqual(await stock(dest), { quantity: 3, value: '450' });
  await assert.rejects(() => core.transferAction(dest, key(), id, 'receive'), {
    code: 'INVALID_STATE',
  });
});
void test('physical count writes variance movements, retains expected quantity, and cannot finalize twice', async () => {
  const id = (
    await core.createCount(s, key(), {
      notes: 'Physical warehouse count',
      lines: [{ productId, counted: 14, unitCost: '150' }],
    })
  ).id;
  await core.finalizeCount(s, key(), id);
  assert.deepEqual(await stock(), { quantity: 14, value: '2100' });
  await assert.rejects(() => core.finalizeCount(s, key(), id), { code: 'INVALID_STATE' });
});
void test('stale stock count fails instead of overwriting intervening sales', async () => {
  const count = (
    await core.createCount(s, key(), {
      notes: 'Stale count test',
      lines: [{ productId, counted: 14, unitCost: '150' }],
    })
  ).id;
  const sale = await finalizeSale(s, key(), {
    lines: [{ productId, quantity: 1 }],
    tendered: '200',
    cashSessionId: registerId,
  });
  assert.deepEqual(await stock(), { quantity: 13, value: '1950' });
  await assert.rejects(() => core.finalizeCount(s, key(), count), { code: 'INVALID_STATE' });
  const receipt = await getReceipt(s, sale.id);
  await returnSale(s, key(), sale.id, {
    lines: [{ saleLineId: receipt.lines[0]!.id, quantity: 1, disposition: 'restockable' }],
    reason: 'Test restock',
    cashSessionId: registerId,
  });
  assert.deepEqual(await stock(), { quantity: 14, value: '2100' });
});
void test('financial totals include invoices, expenses, historical-cost returns and stock losses', async () => {
  const report = object(await core.financialReport(s, today, today));
  assert.equal(report.revenue, '400');
  assert.equal(report.cogs, '300');
  assert.equal(report.grossProfit, '100');
  assert.equal((report.productPerformance as Record<string, unknown>[])[0]?.marginPercent, '25.00');
  assert.equal(report.expenses, '50');
  assert.equal(report.stockLoss, '150');
  assert.equal(report.netOperatingProfit, '-100');
  const lines = await admin.query(
    'SELECT journal_id FROM journal_lines WHERE tenant_id=$1 GROUP BY journal_id HAVING sum(debit-credit)<>0',
    [tenant],
  );
  assert.equal(lines.rowCount, 0);
});
void test('cashier cannot purchase, expense, invoice, transfer or read finance even with forged owner role', async () => {
  const denied = { ...s, userId: cashier, role: 'owner' as const };
  for (const fn of [
    () => core.suppliers(denied),
    () => core.purchases(denied),
    () => core.expenses(denied, today, today),
    () => core.invoices(denied),
    () => core.transfers(denied),
    () => core.financialReport(denied, today, today),
  ])
    await assert.rejects(fn, { code: 'FORBIDDEN' });
  assert.equal((await products(denied, '', 1, 30)).items[0]?.cost, undefined);
});
void test('inventory officer can receive/count/transfer but cannot pay suppliers or access financial statements', async () => {
  const officer = { ...s, userId: inventory };
  await core.purchases(officer);
  await core.counts(officer);
  await core.transfers(officer);
  await assert.rejects(() => core.payables(officer), { code: 'FORBIDDEN' });
  await assert.rejects(() => core.financialReport(officer, today, today), { code: 'FORBIDDEN' });
});
void test('accountant can manage finance but cannot create POS sales or refund by default', async () => {
  const a = { ...s, userId: accountant };
  await core.financialReport(a, today, today);
  await assert.rejects(
    () =>
      finalizeSale(a, key(), {
        lines: [{ productId, quantity: 1 }],
        tendered: '200',
        cashSessionId: registerId,
      }),
    { code: 'FORBIDDEN' },
  );
  await assert.rejects(
    () => returnSale(a, key(), key(), { lines: [], reason: 'Denied', cashSessionId: registerId }),
    { code: 'FORBIDDEN' },
  );
});
void test('cross-tenant and unauthorized branch scopes are denied before data access', async () => {
  await assert.rejects(
    () =>
      core.suppliers({
        ...s,
        tenantId: foreignTenant,
        businessId: foreignBusiness,
        branchId: foreignBranch,
      }),
    { code: 'FORBIDDEN' },
  );
  await assert.rejects(() => core.purchaseDetail(dest, orderId), { code: 'NOT_FOUND' });
  assert.equal((await db.supplier.findMany()).length, 0);
  assert.equal((await db.supplierBill.findMany()).length, 0);
});
void test('deactivated suppliers cannot receive new purchase orders', async () => {
  await core.saveSupplier(s, key(), { name: 'Inactive supplier', active: false }, supplierId);
  await assert.rejects(
    () =>
      core.savePurchase(s, key(), {
        supplierId,
        orderDate: today,
        lines: [{ productId, quantity: 1, unitCost: '10' }],
      }),
    { code: 'SUPPLIER_UNAVAILABLE' },
  );
});
void test('closed period rolls receipt, stock, idempotency and journal back together', async () => {
  await core.saveSupplier(s, key(), { name: 'Active supplier', active: true }, supplierId);
  const order = (
    await core.savePurchase(s, key(), {
      supplierId,
      orderDate: today,
      lines: [{ productId, quantity: 1, unitCost: '100' }],
    })
  ).id;
  await core.purchaseAction(s, key(), order, 'order');
  const line = String(
      (object(await core.purchaseDetail(s, order)).lines as Record<string, unknown>[])[0]!.id,
    ),
    before = await stock();
  await admin.query(
    'INSERT INTO periods(id,tenant_id,business_id,through_date) VALUES($1,$2,$3,$4)',
    [key(), tenant, business, today],
  );
  await assert.rejects(
    () => core.receivePurchase(s, key(), order, { lines: [{ lineId: line, quantity: 1 }] }),
    { code: 'PERIOD_CLOSED' },
  );
  assert.deepEqual(await stock(), before);
  await admin.query('DELETE FROM periods WHERE tenant_id=$1', [tenant]);
});
void test('staff role/deactivation updates are audited; owners and self cannot be changed', async () => {
  await core.updateStaff(s, key(), { userId: cashier, role: 'viewer', active: false });
  await assert.rejects(() => core.invoices({ ...s, userId: cashier }), { code: 'FORBIDDEN' });
  await assert.rejects(() =>
    core.updateStaff(s, key(), { userId: user, role: 'viewer', active: false }),
  );
});
void test('fractional partial receipts exhaust rounded order cost even when final delivery has zero incremental value', async () => {
  const order = (
    await core.savePurchase(s, key(), {
      supplierId,
      orderDate: today,
      lines: [{ productId, quantity: 1, unitCost: '1' }],
    })
  ).id;
  await core.purchaseAction(s, key(), order, 'order');
  const line = String(
    (object(await core.purchaseDetail(s, order)).lines as Record<string, unknown>[])[0]!.id,
  );
  const initial = await stock();
  await core.receivePurchase(s, key(), order, { lines: [{ lineId: line, quantity: 0.6 }] });
  await core.receivePurchase(s, key(), order, { lines: [{ lineId: line, quantity: 0.4 }] });
  const final = await stock();
  assert.equal(final.quantity, initial.quantity + 1);
  assert.equal(BigInt(final.value) - BigInt(initial.value), 1n);
  assert.equal(object(object(await core.purchaseDetail(s, order)).order).status, 'received');
});
void test('industry modules are enforced independently of a valid owner membership', async () => {
  await admin.query("UPDATE businesses SET industry_id='real_estate_agency' WHERE id=$1", [
    business,
  ]);
  try {
    await assert.rejects(() => core.purchases(s), { code: 'MODULE_UNAVAILABLE' });
  } finally {
    await admin.query('UPDATE businesses SET industry_id=NULL WHERE id=$1', [business]);
  }
});
void test('branch performance includes only authorized branches in this business', async () => {
  const result = await core.branchPerformance(s, today, today);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map((r) => r.id).sort(), [branch, destination].sort());
  await assert.rejects(() => core.branchPerformance({ ...s, userId: cashier }, today, today), {
    code: 'FORBIDDEN',
  });
});
void test('purchasing, manager and auditor templates enforce backend write boundaries', async () => {
  for (const role of ['purchasing', 'manager', 'viewer']) {
    const actor = key();
    await admin.query(
      'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$3,$2,true,now(),now())',
      [actor, actor + '@example.test', 'Role test'],
    );
    await admin.query(
      'INSERT INTO memberships(id,user_id,tenant_id,business_id,branch_id,role) VALUES($1,$2,$3,$4,$5,$6)',
      [key(), actor, tenant, business, branch, role],
    );
    const scope = { ...s, userId: actor };
    await core.suppliers(scope);
    await core.purchases(scope);
    if (role === 'viewer') {
      await core.invoices(scope);
      await core.financialReport(scope, today, today);
      await assert.rejects(() => core.saveSupplier(scope, key(), { name: 'Denied viewer write' }), {
        code: 'FORBIDDEN',
      });
      await assert.rejects(
        () =>
          core.createCount(scope, key(), {
            notes: 'Denied count',
            lines: [{ productId, counted: 1, unitCost: '1' }],
          }),
        { code: 'FORBIDDEN' },
      );
    }
    if (role === 'purchasing') {
      await core.saveSupplier(scope, key(), { name: 'Purchasing supplier' });
      await assert.rejects(() => core.payables(scope), { code: 'FORBIDDEN' });
      await assert.rejects(() => core.financialReport(scope, today, today), { code: 'FORBIDDEN' });
    }
    if (role === 'manager') {
      await core.financialReport(scope, today, today);
      await assert.rejects(
        () => core.updateStaff(scope, key(), { userId: user, role: 'cashier', active: false }),
        { code: 'FORBIDDEN' },
      );
    }
  }
});
after(async () => {
  await admin.end();
  await db.$disconnect();
  await pool.end();
});
