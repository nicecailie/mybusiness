import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { Scope } from '../../../packages/contracts/src/index.js';
import * as c from '../../../packages/contracts/src/core.js';
import {
  DomainError,
  lineAmount,
  allocatedCost,
  quantityUnits,
  requirePermission,
  can,
} from '../../../packages/domain/src/index.js';
import { audit, ownership, scoped, write, contexts, type Transaction } from './database.js';
import { postJournal } from './accounting.js';

const json = <T>(v: T): Prisma.JsonValue => JSON.parse(JSON.stringify(v)) as Prisma.JsonValue;
const missing = () =>
  new DomainError('NOT_FOUND', 'Record not found in this business and branch.', 404);
const conflict = (message: string) => new DomainError('INVALID_STATE', message, 409);
export function marginPercentage(revenue: string, cost: string): string | null {
  if (BigInt(revenue) <= 0n) return null;
  const points = ((BigInt(revenue) - BigInt(cost)) * 10000n) / BigInt(revenue),
    absolute = points < 0n ? -points : points;
  return (
    (points < 0n ? '-' : '') +
    (absolute / 100n).toString() +
    '.' +
    (absolute % 100n).toString().padStart(2, '0')
  );
}
const businessScope = (s: Scope) => ({ tenantId: s.tenantId, businessId: s.businessId });
async function lock(tx: Transaction, kind: string, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${kind + ':' + id},0))`;
}
async function number(tx: Transaction, prefix: string) {
  const seq = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('document_sequence') AS n`;
  return `${prefix}-${String(seq[0]!.n).padStart(6, '0')}`;
}
async function activeSupplier(tx: Transaction, id: string) {
  const supplier = await tx.supplier.findFirst({ where: { id, active: true } });
  if (!supplier)
    throw new DomainError(
      'SUPPLIER_UNAVAILABLE',
      'Choose an active supplier in this business.',
      404,
    );
  return supplier;
}
async function postingDate(tx: Transaction, s: Scope, date: string) {
  const b = await tx.business.findUniqueOrThrow({ where: { id: s.businessId } });
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: b.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  // The existing journal has only created_at. Do not silently backdate financial recognition.
  if (date !== today)
    throw new DomainError(
      'POSTING_DATE',
      'Use today’s business date. Historical posting needs a separate accounting-date migration.',
    );
}

// Shared movement primitive for new inventory workflows: same balance and lock key as POS/catalog.
// Journal counterpart is selected by the calling business transaction, never opening equity for purchases.
export async function moveStock(
  tx: Transaction,
  s: Scope,
  productId: string,
  quantity: number,
  sourceType: string,
  sourceId: string,
  reason: string,
  incomingValue?: bigint,
) {
  const p = await tx.product.findFirst({
    where: { id: productId, archived: false, type: 'goods' },
  });
  if (!p)
    throw new DomainError('PRODUCT_UNAVAILABLE', 'Choose an active stock-tracked product.', 404);
  await lock(tx, 'stock', s.branchId + ':' + productId);
  const b = await tx.stockBalance.findFirst({ where: { productId } }),
    available = Number(b?.onHand ?? 0);
  if (available < 0)
    throw conflict('Resolve the existing shortage valuation before moving valued stock.');
  if (quantity < 0 && -quantity > available)
    throw new DomainError('INSUFFICIENT_STOCK', 'Not enough stock for this operation.', 409);
  const value =
    quantity < 0 ? -allocatedCost(b!.value.toString(), -quantity, available) : incomingValue;
  if (value === undefined || (quantity > 0 && value < 0n))
    throw conflict('A reviewed incoming stock value is required.');
  if (b)
    await tx.stockBalance.update({
      where: { id: b.id },
      data: { onHand: { increment: quantity }, value: { increment: value.toString() } },
    });
  else
    await tx.stockBalance.create({
      data: {
        id: randomUUID(),
        ...ownership(s),
        productId,
        onHand: quantity,
        value: value.toString(),
      },
    });
  await tx.stockMovement.create({
    data: {
      id: randomUUID(),
      ...ownership(s),
      productId,
      quantity,
      value: value.toString(),
      sourceType,
      sourceId,
      reason,
      actorId: s.userId,
    },
  });
  return value;
}

export const suppliers = (s: Scope, search = '', page = 1) =>
  scoped(s, 'supplier.read', async (tx) =>
    json({
      items: await tx.supplier.findMany({
        where: { name: { contains: search, mode: 'insensitive' } },
        orderBy: { name: 'asc' },
        skip: (page - 1) * 30,
        take: 30,
      }),
      total: await tx.supplier.count({
        where: { name: { contains: search, mode: 'insensitive' } },
      }),
    }),
  );
export function saveSupplier(s: Scope, key: string, input: unknown, id?: string) {
  const data = c.supplierSchema.parse(input);
  return write(
    s,
    id ? 'supplier.update' : 'supplier.create',
    'supplier.save',
    key,
    { id, data },
    (tx, a) => saveSupplierInTransaction(tx, a, data, id),
  );
}
export async function saveSupplierInTransaction(
  tx: Transaction,
  a: Scope,
  data: z.infer<typeof c.supplierSchema>,
  id?: string,
) {
  const supplierId = id ?? randomUUID();
  if (id) {
    if (!(await tx.supplier.findFirst({ where: { id } }))) throw missing();
    await tx.supplier.update({ where: { id }, data: { ...data, updatedAt: new Date() } });
  } else await tx.supplier.create({ data: { id: supplierId, ...businessScope(a), ...data } });
  await audit(tx, a, id ? 'supplier.updated' : 'supplier.created', supplierId);
  return { id: supplierId };
}
export const supplierDetail = (s: Scope, id: string) =>
  scoped(s, 'supplier.read', async (tx, a) => {
    const supplier = await tx.supplier.findFirst({ where: { id } });
    if (!supplier) throw missing();
    const orders = await tx.purchaseOrder.findMany({
      where: { supplierId: id },
      orderBy: { createdAt: 'desc' },
    });
    // Payments and balances require finance access even if the user can purchase stock.
    let bills: unknown[] = [];
    try {
      requirePermission(a.role, 'payable.manage');
      bills = await tx.supplierBill.findMany({ where: { supplierId: id } });
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
    }
    return json({ supplier, orders, bills });
  });
export const purchases = (s: Scope, page = 1) =>
  scoped(s, 'purchase.read', async (tx) =>
    json({
      items: await tx.purchaseOrder.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * 30,
        take: 30,
      }),
      total: await tx.purchaseOrder.count(),
    }),
  );
export const purchaseDetail = (s: Scope, id: string) =>
  scoped(s, 'purchase.read', async (tx) => {
    const order = await tx.purchaseOrder.findFirst({ where: { id } });
    if (!order) throw missing();
    const lines = await tx.purchaseLine.findMany({ where: { orderId: id } }),
      products = await tx.product.findMany({
        where: { id: { in: lines.map((l) => l.productId) } },
      });
    return json({
      order,
      lines: lines.map((l) => ({
        ...l,
        productName: products.find((p) => p.id === l.productId)?.name,
        remaining: Number(l.quantity) - Number(l.received),
      })),
      receipts: await tx.goodsReceipt.findMany({ where: { orderId: id } }),
    });
  });
export function savePurchase(s: Scope, key: string, input: unknown, id?: string) {
  const data = c.purchaseSchema.parse(input);
  return write(s, 'purchase.create', 'purchase.save', key, { id, data }, (tx, a) =>
    savePurchaseInTransaction(tx, a, data, id),
  );
}
export async function savePurchaseInTransaction(
  tx: Transaction,
  a: Scope,
  data: z.infer<typeof c.purchaseSchema>,
  id?: string,
) {
  await activeSupplier(tx, data.supplierId);
  const orderId = id ?? randomUUID();
  if (id) {
    await lock(tx, 'purchase', id);
    const p = await tx.purchaseOrder.findFirst({ where: { id } });
    if (!p) throw missing();
    if (p.status !== 'draft') throw conflict('Only draft orders can be edited.');
  }
  const total = data.lines.reduce((n, l) => n + lineAmount(l.unitCost, l.quantity), 0n).toString();
  if (BigInt(total) <= 0n || BigInt(total) > 999999999999999n)
    throw conflict('Order total is outside the supported range.');
  for (const l of data.lines)
    if (
      !(await tx.product.findFirst({
        where: { id: l.productId, type: 'goods', archived: false },
      }))
    )
      throw missing();
  const { lines, ...fields } = data;
  if (id) {
    await tx.purchaseLine.deleteMany({ where: { orderId: id } });
    await tx.purchaseOrder.update({ where: { id }, data: { ...fields, total } });
  } else
    await tx.purchaseOrder.create({
      data: {
        id: orderId,
        ...ownership(a),
        ...fields,
        total,
        number: await number(tx, 'PO'),
        actorId: a.userId,
      },
    });
  await tx.purchaseLine.createMany({
    data: lines.map((l) => ({
      id: randomUUID(),
      ...ownership(a),
      orderId,
      ...l,
      total: lineAmount(l.unitCost, l.quantity).toString(),
    })),
  });
  await audit(tx, a, 'purchase.saved', orderId);
  return { id: orderId };
}
export function purchaseAction(s: Scope, key: string, id: string, action: 'order' | 'cancel') {
  return write(s, 'purchase.approve', 'purchase.' + action, key, { id }, async (tx, a) => {
    await lock(tx, 'purchase', id);
    const p = await tx.purchaseOrder.findFirst({ where: { id } });
    if (!p) throw missing();
    if (action === 'order') {
      if (p.status !== 'draft') throw conflict('Only a draft can be ordered.');
      await activeSupplier(tx, p.supplierId);
    } else if (!['draft', 'ordered'].includes(p.status))
      throw conflict('An order with receipts cannot be cancelled.');
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: action === 'order' ? 'ordered' : 'cancelled' },
    });
    await audit(tx, a, 'purchase.' + action, id);
    return { id };
  });
}
export function receivePurchase(s: Scope, key: string, id: string, input: unknown) {
  const data = c.receiptSchema.parse(input);
  return write(s, 'purchase.receive', 'purchase.receive', key, { id, data }, (tx, a) =>
    receivePurchaseInTransaction(tx, a, data, id),
  );
}
export async function receivePurchaseInTransaction(
  tx: Transaction,
  a: Scope,
  data: z.infer<typeof c.receiptSchema>,
  id: string,
) {
  await lock(tx, 'purchase', id);
  const order = await tx.purchaseOrder.findFirst({ where: { id } });
  if (!order) throw missing();
  if (!['ordered', 'partially_received'].includes(order.status))
    throw conflict('This order cannot receive more stock.');
  const lines = await tx.purchaseLine.findMany({
      where: { orderId: id },
      orderBy: { productId: 'asc' },
    }),
    receiptId = randomUUID();
  let total = 0n;
  const receiving = [];
  for (const l of lines) {
    const item = data.lines.find((x) => x.lineId === l.id);
    if (!item) continue;
    const units = quantityUnits(item.quantity),
      remaining = quantityUnits(Number(l.quantity)) - quantityUnits(Number(l.received));
    if (units > remaining)
      throw conflict('Received quantity exceeds the remaining order quantity.');
    // Allocate rounded cumulative totals so partial receipts exactly exhaust the order value.
    const cumulative = Number(quantityUnits(Number(l.received)) + units) / 1000;
    const value =
      lineAmount(l.unitCost.toString(), cumulative) -
      (Number(l.received) > 0 ? lineAmount(l.unitCost.toString(), Number(l.received)) : 0n);
    receiving.push({ l, item, value });
    total += value;
  }
  if (receiving.length !== data.lines.length)
    throw conflict('Choose order lines with a positive receipt value.');
  await tx.goodsReceipt.create({
    data: {
      id: receiptId,
      ...ownership(a),
      orderId: id,
      number: await number(tx, 'GR'),
      actorId: a.userId,
      total: total.toString(),
    },
  });
  for (const { l, item, value } of receiving) {
    await moveStock(
      tx,
      a,
      l.productId,
      item.quantity,
      'purchase_receipt',
      receiptId,
      'Purchase goods receipt',
      value,
    );
    await tx.purchaseLine.update({
      where: { id: l.id },
      data: { received: { increment: item.quantity } },
    });
    await tx.goodsReceiptLine.create({
      data: {
        id: randomUUID(),
        ...ownership(a),
        receiptId,
        lineId: l.id,
        quantity: item.quantity,
        value: value.toString(),
      },
    });
  }
  const remaining = await tx.purchaseLine.findMany({ where: { orderId: id } });
  await tx.purchaseOrder.update({
    where: { id },
    data: {
      status: remaining.every((l) => l.received.equals(l.quantity))
        ? 'received'
        : 'partially_received',
    },
  });
  if (total > 0n)
    await postJournal(tx, a, 'purchase_receipt', receiptId, [
      { account: '1200 Inventory', debit: total.toString(), credit: '0' },
      { account: '2100 Goods received not billed', debit: '0', credit: total.toString() },
    ]);
  await audit(tx, a, 'purchase.received', receiptId);
  return { id: receiptId };
}
export function createBill(s: Scope, key: string, input: unknown) {
  const data = c.billSchema.parse(input);
  return write(s, 'payable.manage', 'bill.create', key, data, (tx, a) =>
    createBillInTransaction(tx, a, data),
  );
}
export async function createBillInTransaction(
  tx: Transaction,
  a: Scope,
  data: z.infer<typeof c.billSchema>,
) {
  await postingDate(tx, a, data.billDate);
  const receipt = await tx.goodsReceipt.findFirst({ where: { id: data.receiptId } });
  if (!receipt) throw missing();
  if (BigInt(receipt.total.toString()) === 0n)
    throw conflict('A zero-value delivery has no supplier liability to bill.');
  const order = await tx.purchaseOrder.findFirstOrThrow({ where: { id: receipt.orderId } });
  const id = randomUUID();
  await tx.supplierBill.create({
    data: {
      id,
      ...ownership(a),
      ...data,
      supplierId: order.supplierId,
      total: receipt.total,
      actorId: a.userId,
    },
  });
  await postJournal(tx, a, 'supplier_bill', id, [
    { account: '2100 Goods received not billed', debit: receipt.total.toString(), credit: '0' },
    { account: '2000 Accounts payable', debit: '0', credit: receipt.total.toString() },
  ]);
  await audit(tx, a, 'bill.created', id);
  return { id };
}
async function businessToday(tx: Transaction, s: Scope) {
  const b = await tx.business.findUniqueOrThrow({ where: { id: s.businessId } });
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: b.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
function balanceStatus(total: string, paid: string, due: string, today: string) {
  return BigInt(total) === BigInt(paid)
    ? 'paid'
    : due < today
      ? 'overdue'
      : BigInt(paid) > 0n
        ? 'partially_paid'
        : 'unpaid';
}
export const payables = (s: Scope) =>
  scoped(s, 'payable.manage', async (tx, a) => {
    const items = await tx.supplierBill.findMany({ orderBy: { dueDate: 'asc' } }),
      suppliers = await tx.supplier.findMany(),
      today = await businessToday(tx, a);
    return json({
      items: items.map((i) => ({
        ...i,
        supplierName: suppliers.find((p) => p.id === i.supplierId)?.name,
        displayStatus: balanceStatus(i.total.toString(), i.paid.toString(), i.dueDate, today),
      })),
      payments: await tx.financePayment.findMany({ where: { billId: { not: null } } }),
    });
  });
export function settle(
  s: Scope,
  key: string,
  id: string,
  input: unknown,
  kind: 'bill' | 'invoice',
) {
  const data = c.settlementSchema.parse(input);
  return write(
    s,
    kind === 'bill' ? 'payable.manage' : 'invoice.payment',
    kind + '.payment',
    key,
    { id, data },
    (tx, a) => settleInTransaction(tx, a, data, id, kind),
  );
}
export async function settleInTransaction(
  tx: Transaction,
  a: Scope,
  data: z.infer<typeof c.settlementSchema>,
  id: string,
  kind: 'bill' | 'invoice',
) {
  await lock(tx, kind, id);
  const row =
    kind === 'bill'
      ? await tx.supplierBill.findFirst({ where: { id } })
      : await tx.invoice.findFirst({ where: { id } });
  if (!row) throw missing();
  if ('status' in row && row.status !== 'issued')
    throw conflict('Only issued invoices can receive payment.');
  if (BigInt(data.amount) > BigInt(row.total.toString()) - BigInt(row.paid.toString()))
    throw conflict('Payment exceeds the outstanding balance.');
  const paymentId = randomUUID();
  await tx.financePayment.create({
    data: {
      id: paymentId,
      ...ownership(a),
      ...data,
      ...(kind === 'bill' ? { billId: id } : { invoiceId: id }),
      actorId: a.userId,
    },
  });
  if (kind === 'bill')
    await tx.supplierBill.update({ where: { id }, data: { paid: { increment: data.amount } } });
  else await tx.invoice.update({ where: { id }, data: { paid: { increment: data.amount } } });
  const debit = kind === 'bill' ? '2000 Accounts payable' : data.account,
    credit = kind === 'bill' ? data.account : '1300 Accounts receivable';
  await postJournal(tx, a, kind + '_payment', paymentId, [
    { account: debit, debit: data.amount, credit: '0' },
    { account: credit, debit: '0', credit: data.amount },
  ]);
  await audit(tx, a, kind + '.payment_recorded', paymentId, data.reference);
  return { id: paymentId };
}
export const categories = (s: Scope) =>
  scoped(s, 'expense.read', async (tx) =>
    json(await tx.expenseCategory.findMany({ where: { active: true }, orderBy: { name: 'asc' } })),
  );
export function createCategory(s: Scope, key: string, input: unknown) {
  const data = c.categorySchema.parse(input);
  const fingerprint =
    typeof input === 'object' && input !== null && Object.hasOwn(input, 'kind')
      ? data
      : { name: data.name };
  return write(s, 'expense.create', 'expense.category', key, fingerprint, async (tx, a) => {
    const id = randomUUID();
    await tx.expenseCategory.create({ data: { id, ...businessScope(a), ...data } });
    await audit(tx, a, 'expense.category_created', id);
    return { id };
  });
}
export const expenses = (s: Scope, from: string, to: string, categoryId?: string) =>
  scoped(s, 'expense.read', async (tx) => {
    const items = await tx.expense.findMany({
      where: { expenseDate: { gte: from, lte: to }, ...(categoryId ? { categoryId } : {}) },
      orderBy: { expenseDate: 'desc' },
    });
    return json({
      items,
      total: items
        .filter((e) => e.status === 'posted')
        .reduce((n, e) => n + BigInt(e.amount.toString()), 0n)
        .toString(),
    });
  });
export function createExpense(s: Scope, key: string, input: unknown) {
  const data = c.expenseSchema.parse(input);
  return write(s, 'expense.create', 'expense.create', key, data, async (tx, a) => {
    await postingDate(tx, a, data.expenseDate);
    const category = await tx.expenseCategory.findFirst({
      where: { id: data.categoryId, active: true },
    });
    if (!category) throw missing();
    const postingAccount =
      category.kind === 'equipment'
        ? '1500 Equipment'
        : category.kind === 'other'
          ? '6100 Other spending'
          : '6000 Operating expenses';
    if (data.supplierId) await activeSupplier(tx, data.supplierId);
    const id = randomUUID();
    await tx.expense.create({
      data: { id, ...ownership(a), ...data, postingAccount, actorId: a.userId },
    });
    await postJournal(tx, a, 'expense', id, [
      { account: postingAccount, debit: data.amount, credit: '0' },
      { account: data.account, debit: '0', credit: data.amount },
    ]);
    await audit(tx, a, 'expense.created', id);
    return { id };
  });
}
export function reverseExpense(s: Scope, key: string, id: string, reason: string) {
  return write(s, 'expense.reverse', 'expense.reverse', key, { id, reason }, async (tx, a) => {
    await lock(tx, 'expense', id);
    const e = await tx.expense.findFirst({ where: { id } });
    if (!e) throw missing();
    if (e.status !== 'posted') throw conflict('Expense already reversed.');
    await tx.expense.update({ where: { id }, data: { status: 'reversed' } });
    await postJournal(tx, a, 'expense_reversal', id, [
      { account: e.account, debit: e.amount.toString(), credit: '0' },
      { account: e.postingAccount, debit: '0', credit: e.amount.toString() },
    ]);
    await audit(tx, a, 'expense.reversed', id, reason);
    return { id };
  });
}
export const invoices = (s: Scope, customerId?: string) =>
  scoped(s, 'invoice.read', async (tx, a) => {
    const items = await tx.invoice.findMany({
        where: customerId ? { customerId } : {},
        orderBy: { createdAt: 'desc' },
      }),
      customers = await tx.customer.findMany(),
      today = await businessToday(tx, a);
    return json({
      items: items.map((i) => ({
        ...i,
        customerName: customers.find((c) => c.id === i.customerId)?.name,
        displayStatus:
          i.status === 'issued'
            ? balanceStatus(i.total.toString(), i.paid.toString(), i.dueDate, today)
            : i.status,
      })),
    });
  });
export const invoiceDetail = (s: Scope, id: string) =>
  scoped(s, 'invoice.read', async (tx) => {
    const invoice = await tx.invoice.findFirst({ where: { id } });
    if (!invoice) throw missing();
    return json({
      invoice,
      customer: await tx.customer.findFirst({ where: { id: invoice.customerId } }),
      lines: await tx.invoiceLine.findMany({ where: { invoiceId: id } }),
      payments: await tx.financePayment.findMany({ where: { invoiceId: id } }),
    });
  });
export function createInvoice(s: Scope, key: string, input: unknown) {
  const data = c.invoiceSchema.parse(input);
  return write(s, 'invoice.create', 'invoice.create', key, data, async (tx, a) => {
    if (!(await tx.customer.findFirst({ where: { id: data.customerId, archived: false } })))
      throw missing();
    const id = randomUUID();
    let total = 0n;
    const lines = [];
    if (data.saleId) {
      const sale = await tx.sale.findFirst({
        where: { id: data.saleId, customerId: data.customerId },
      });
      if (!sale) throw missing();
      const payment = await tx.payment.findFirst({
        where: { saleId: sale.id, direction: 'in', status: 'confirmed' },
      });
      if (!payment) throw conflict('Only a confirmed fully paid sale can be linked.');
      total = BigInt(sale.total.toString());
      if (await tx.return.findFirst({ where: { saleId: sale.id } }))
        throw conflict('A returned sale cannot be linked to a new invoice.');
      const original = await tx.saleLine.findMany({ where: { saleId: sale.id } });
      for (const l of original) {
        if (l.discount.toString() !== '0')
          throw conflict('Discounted receipts remain the original sale document.');
        lines.push({
          productId: l.productId,
          name: l.name,
          quantity: Number(l.quantity),
          unitPrice: l.unitPrice.toString(),
          total: l.total.toString(),
        });
      }
    } else
      for (const l of data.lines) {
        const p = await tx.product.findFirst({ where: { id: l.productId, archived: false } });
        if (!p) throw missing();
        const value = lineAmount(l.unitPrice, l.quantity);
        total += value;
        lines.push({ ...l, name: p.name, total: value.toString() });
      }
    if (total <= 0n || total > 999999999999999n)
      throw conflict('Invoice total is outside the supported range.');
    await tx.invoice.create({
      data: {
        id,
        ...ownership(a),
        customerId: data.customerId,
        saleId: data.saleId,
        invoiceDate: data.invoiceDate,
        dueDate: data.dueDate,
        notes: data.notes,
        number: await number(tx, 'INV'),
        total: total.toString(),
        paid: data.saleId ? total.toString() : '0',
        status: data.saleId ? 'issued' : 'draft',
        actorId: a.userId,
      },
    });
    await tx.invoiceLine.createMany({
      data: lines.map((l) => ({ id: randomUUID(), ...ownership(a), invoiceId: id, ...l })),
    });
    await audit(tx, a, 'invoice.created', id);
    return { id };
  });
}
export function issueInvoice(s: Scope, key: string, id: string) {
  return write(s, 'invoice.issue', 'invoice.issue', key, { id }, async (tx, a) => {
    await lock(tx, 'invoice', id);
    const i = await tx.invoice.findFirst({ where: { id } });
    if (!i) throw missing();
    if (i.status !== 'draft') throw conflict('Only draft invoices can be issued.');
    await postingDate(tx, a, i.invoiceDate);
    const lines = await tx.invoiceLine.findMany({
      where: { invoiceId: id },
      orderBy: { productId: 'asc' },
    });
    let cost = 0n;
    for (const l of lines) {
      const p = await tx.product.findFirst({ where: { id: l.productId, archived: false } });
      if (!p) throw missing();
      if (p.type === 'goods') {
        const value = -(await moveStock(
          tx,
          a,
          p.id,
          -Number(l.quantity),
          'invoice',
          id,
          'Issued customer invoice',
        ));
        cost += value;
        await tx.invoiceLine.update({ where: { id: l.id }, data: { cost: value.toString() } });
      }
    }
    await postJournal(tx, a, 'invoice', id, [
      { account: '1300 Accounts receivable', debit: i.total.toString(), credit: '0' },
      { account: '4000 Sales', debit: '0', credit: i.total.toString() },
      ...(cost > 0n
        ? [
            { account: '5000 Cost of sales', debit: cost.toString(), credit: '0' },
            { account: '1200 Inventory', debit: '0', credit: cost.toString() },
          ]
        : []),
    ]);
    await tx.invoice.update({ where: { id }, data: { status: 'issued' } });
    await audit(tx, a, 'invoice.issued', id);
    return { id };
  });
}
export function voidInvoice(s: Scope, key: string, id: string) {
  return write(s, 'invoice.issue', 'invoice.void', key, { id }, async (tx, a) => {
    await lock(tx, 'invoice', id);
    const i = await tx.invoice.findFirst({ where: { id } });
    if (!i) throw missing();
    if (i.status !== 'draft')
      throw conflict(
        'Only unissued drafts can be voided; issued invoices require a credit-note workflow.',
      );
    await tx.invoice.update({ where: { id }, data: { status: 'void' } });
    await audit(tx, a, 'invoice.voided', id);
    return { id };
  });
}
export const transfers = (s: Scope) =>
  scoped(s, 'stock.transfer', async (tx) =>
    json({
      items: await tx.stockTransfer.findMany({ orderBy: { createdAt: 'desc' } }),
      lines: await tx.stockTransferLine.findMany(),
    }),
  );
export function createTransfer(s: Scope, key: string, input: unknown) {
  const data = c.transferSchema.parse(input);
  return write(s, 'stock.transfer', 'transfer.create', key, data, async (tx, a) => {
    if (data.destinationId === a.branchId) throw conflict('Choose a different destination branch.');
    if (!(await tx.branch.findFirst({ where: { id: data.destinationId, ...businessScope(a) } })))
      throw missing();
    const id = randomUUID();
    await tx.stockTransfer.create({
      data: {
        id,
        ...ownership(a),
        destinationId: data.destinationId,
        number: await number(tx, 'TR'),
        actorId: a.userId,
      },
    });
    for (const l of data.lines) {
      if (
        !(await tx.product.findFirst({
          where: { id: l.productId, archived: false, type: 'goods' },
        }))
      )
        throw missing();
      await tx.stockTransferLine.create({
        data: { id: randomUUID(), ...ownership(a), transferId: id, ...l },
      });
    }
    await audit(tx, a, 'transfer.created', id);
    return { id };
  });
}
export function transferAction(
  s: Scope,
  key: string,
  id: string,
  action: 'send' | 'receive' | 'cancel',
) {
  return write(s, 'stock.transfer', 'transfer.' + action, key, { id }, async (tx, a) => {
    await lock(tx, 'transfer', id);
    const t = await tx.stockTransfer.findFirst({ where: { id } });
    if (!t) throw missing();
    if (action === 'cancel') {
      if (t.branchId !== a.branchId || t.status !== 'draft')
        throw conflict('Only the source branch can cancel a draft transfer.');
      await tx.stockTransfer.update({ where: { id }, data: { status: 'cancelled' } });
    } else {
      if (action === 'send' && (t.branchId !== a.branchId || t.status !== 'draft'))
        throw conflict('Only a draft at its source branch can be sent.');
      if (action === 'receive' && (t.destinationId !== a.branchId || t.status !== 'sent'))
        throw conflict('Only a sent transfer can be received at its destination.');
      let total = 0n;
      const lines = await tx.stockTransferLine.findMany({
        where: { transferId: id },
        orderBy: { productId: 'asc' },
      });
      for (const l of lines) {
        const value =
          action === 'send'
            ? -(await moveStock(
                tx,
                a,
                l.productId,
                -Number(l.quantity),
                'transfer_out',
                id,
                'Stock sent to another branch',
              ))
            : await moveStock(
                tx,
                a,
                l.productId,
                Number(l.quantity),
                'transfer_in',
                id,
                'Stock received from another branch',
                BigInt(l.value.toString()),
              );
        total += value;
        if (action === 'send')
          await tx.stockTransferLine.update({
            where: { id: l.id },
            data: { value: value.toString() },
          });
      }
      if (total > 0n)
        await postJournal(
          tx,
          a,
          'transfer_' + action,
          id,
          action === 'send'
            ? [
                { account: '1250 Inventory in transit', debit: total.toString(), credit: '0' },
                { account: '1200 Inventory', debit: '0', credit: total.toString() },
              ]
            : [
                { account: '1200 Inventory', debit: total.toString(), credit: '0' },
                { account: '1250 Inventory in transit', debit: '0', credit: total.toString() },
              ],
        );
      await tx.stockTransfer.update({
        where: { id },
        data:
          action === 'send'
            ? { status: 'sent', sentBy: a.userId, sentAt: new Date() }
            : { status: 'received', receivedBy: a.userId, receivedAt: new Date() },
      });
    }
    await audit(tx, a, 'transfer.' + action, id);
    return { id };
  });
}
export const counts = (s: Scope) =>
  scoped(s, 'stock.count', async (tx) =>
    json({
      items: await tx.stockCount.findMany({ orderBy: { createdAt: 'desc' } }),
      lines: await tx.stockCountLine.findMany(),
    }),
  );
export function createCount(s: Scope, key: string, input: unknown) {
  const data = c.countSchema.parse(input);
  return write(s, 'stock.count', 'count.create', key, data, async (tx, a) => {
    const id = randomUUID();
    await tx.stockCount.create({
      data: {
        id,
        ...ownership(a),
        number: await number(tx, 'SC'),
        notes: data.notes,
        actorId: a.userId,
      },
    });
    for (const l of [...data.lines].sort((x, y) => x.productId.localeCompare(y.productId))) {
      if (
        !(await tx.product.findFirst({
          where: { id: l.productId, type: 'goods', archived: false },
        }))
      )
        throw missing();
      await lock(tx, 'stock', a.branchId + ':' + l.productId);
      const b = await tx.stockBalance.findFirst({ where: { productId: l.productId } });
      if (Number(b?.onHand ?? 0) < 0)
        throw conflict('Resolve provisional shortages before stocktaking.');
      await tx.stockCountLine.create({
        data: { id: randomUUID(), ...ownership(a), countId: id, ...l, expected: b?.onHand ?? 0 },
      });
    }
    await audit(tx, a, 'count.created', id, data.notes);
    return { id };
  });
}
export function finalizeCount(s: Scope, key: string, id: string) {
  return write(s, 'stock.count', 'count.finalize', key, { id }, async (tx, a) => {
    await lock(tx, 'count', id);
    const count = await tx.stockCount.findFirst({ where: { id } });
    if (!count) throw missing();
    if (count.status !== 'draft') throw conflict('This count is already finalized.');
    for (const l of await tx.stockCountLine.findMany({
      where: { countId: id },
      orderBy: { productId: 'asc' },
    })) {
      await lock(tx, 'stock', a.branchId + ':' + l.productId);
      const b = await tx.stockBalance.findFirst({ where: { productId: l.productId } });
      if (!l.expected.equals(b?.onHand ?? 0))
        throw conflict(
          'Stock changed after counting. Start a new count to avoid overwriting movements.',
        );
      const variance =
        Number(quantityUnits(Number(l.counted)) - quantityUnits(Number(l.expected))) / 1000;
      if (!variance) continue;
      if (variance > 0 && BigInt(l.unitCost.toString()) <= 0n)
        throw conflict('Positive variance needs a reviewed positive unit cost.');
      const value = await moveStock(
        tx,
        a,
        l.productId,
        variance,
        'stock_count',
        id,
        count.notes,
        variance > 0 ? lineAmount(l.unitCost.toString(), variance) : undefined,
      );
      if (value !== 0n)
        await postJournal(
          tx,
          a,
          'stock_count',
          l.id,
          value > 0n
            ? [
                { account: '1200 Inventory', debit: value.toString(), credit: '0' },
                { account: '5200 Stock variance', debit: '0', credit: value.toString() },
              ]
            : [
                { account: '5200 Stock variance', debit: (-value).toString(), credit: '0' },
                { account: '1200 Inventory', debit: '0', credit: (-value).toString() },
              ],
        );
    }
    await tx.stockCount.update({
      where: { id },
      data: { status: 'finalized', finalizedBy: a.userId, finalizedAt: new Date() },
    });
    await audit(tx, a, 'count.finalized', id, count.notes);
    return { id };
  });
}
export const customerBalance = (s: Scope, id: string) =>
  scoped(s, 'invoice.read', async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id } });
    if (!customer) throw missing();
    const invoices = await tx.invoice.findMany({ where: { customerId: id } }),
      payments = await tx.financePayment.findMany({
        where: { invoiceId: { in: invoices.map((i) => i.id) } },
      });
    return json({
      customer,
      invoices,
      payments,
      balance: invoices
        .filter((i) => i.status === 'issued')
        .reduce((n, i) => n + BigInt(i.total.toString()) - BigInt(i.paid.toString()), 0n)
        .toString(),
    });
  });
export const financialReport = (s: Scope, from: string, to: string) =>
  scoped(s, 'finance.read', (tx, a) => financialReportInTransaction(tx, a, from, to));
export async function financialReportInTransaction(
  tx: Transaction,
  a: Scope,
  from: string,
  to: string,
) {
  const b = await tx.business.findUniqueOrThrow({ where: { id: a.businessId } });
  const lines = await tx.$queryRaw<
    { account: string; debit: string; credit: string }[]
  >`SELECT l.account,sum(l.debit)::text AS debit,sum(l.credit)::text AS credit FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE (j.created_at AT TIME ZONE ${b.timezone})::date BETWEEN ${from}::date AND ${to}::date GROUP BY l.account`;
  const net = (prefix: string) =>
    lines
      .filter((l) => l.account.startsWith(prefix))
      .reduce((n, l) => n + BigInt(l.debit) - BigInt(l.credit), 0n);
  const revenue = -net('4'),
    cogs = net('5000'),
    stockLoss = net('51') + net('52'),
    expenses = net('6');
  const receivables = await tx.invoice.findMany({ where: { status: 'issued' } }),
    payables = await tx.supplierBill.findMany(),
    inventory = await tx.stockBalance.findMany();
  const pending = await tx.sale.count({ where: { valuationPending: true } });
  const productPerformance = await tx.$queryRaw<
    { productId: string; quantity: string; revenue: string; cost: string }[]
  >`SELECT product_id AS "productId",sum(qty)::text AS quantity,sum(revenue)::text AS revenue,sum(cost)::text AS cost FROM (
    SELECT l.product_id,l.quantity AS qty,l.total AS revenue,l.cost FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE (s.created_at AT TIME ZONE ${b.timezone})::date BETWEEN ${from}::date AND ${to}::date
    UNION ALL SELECT l.product_id,l.quantity,l.total,l.cost FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.status='issued' AND i.sale_id IS NULL AND (i.created_at AT TIME ZONE ${b.timezone})::date BETWEEN ${from}::date AND ${to}::date
    UNION ALL SELECT sl.product_id,-rl.quantity,-rl.total,-rl.cost FROM return_lines rl JOIN returns r ON r.id=rl.return_id JOIN sale_lines sl ON sl.id=rl.sale_line_id WHERE (r.created_at AT TIME ZONE ${b.timezone})::date BETWEEN ${from}::date AND ${to}::date
  ) x GROUP BY product_id`;
  const customerNames = await tx.customer.findMany(),
    supplierNames = await tx.supplier.findMany(),
    productNames = await tx.product.findMany();
  const asOf = new Intl.DateTimeFormat('en-CA', {
    timeZone: b.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const paymentStatus = (i: {
    total: { toString(): string };
    paid: { toString(): string };
    dueDate: string;
  }) =>
    BigInt(i.paid.toString()) === BigInt(i.total.toString())
      ? 'paid'
      : i.dueDate < asOf
        ? 'overdue'
        : BigInt(i.paid.toString()) > 0n
          ? 'partially_paid'
          : 'unpaid';
  return json({
    from,
    to,
    currency: b.currency,
    branchId: a.branchId,
    valuationPending: pending > 0,
    revenue: revenue.toString(),
    cogs: cogs.toString(),
    grossProfit: (revenue - cogs).toString(),
    stockLoss: stockLoss.toString(),
    expenses: expenses.toString(),
    netOperatingProfit: (revenue - cogs - stockLoss - expenses).toString(),
    cashMovement: net('1000').toString(),
    bankMovement: net('1010').toString(),
    receivables: receivables.map((i) => ({
      ...i,
      customerName: customerNames.find((c) => c.id === i.customerId)?.name,
      paymentStatus: paymentStatus(i),
      balance: (BigInt(i.total.toString()) - BigInt(i.paid.toString())).toString(),
    })),
    payables: payables.map((i) => ({
      ...i,
      supplierName: supplierNames.find((c) => c.id === i.supplierId)?.name,
      paymentStatus: paymentStatus(i),
      balance: (BigInt(i.total.toString()) - BigInt(i.paid.toString())).toString(),
    })),
    inventory,
    inventoryValue: inventory.reduce((n, i) => n + BigInt(i.value.toString()), 0n).toString(),
    productPerformance: productPerformance.map((p) => ({
      ...p,
      productName: productNames.find((c) => c.id === p.productId)?.name,
      category: productNames.find((c) => c.id === p.productId)?.category ?? '',
      marginPercent: marginPercentage(p.revenue, p.cost),
      grossProfit: (BigInt(p.revenue) - BigInt(p.cost)).toString(),
    })),
  });
}
export function updateStaff(s: Scope, key: string, input: unknown) {
  const data = c.staffUpdateSchema.parse(input);
  return write(s, 'team.update', 'staff.update', key, data, async (tx, a) => {
    if (data.userId === a.userId)
      throw new DomainError('FORBIDDEN', 'You cannot change your own access.', 403);
    const members = await tx.$queryRaw<
      { id: string; role: string }[]
    >`SELECT id,role FROM list_business_staff(${a.userId},${a.businessId}::uuid,${a.branchId}::uuid)`;
    const target = members.find((m) => m.id === data.userId);
    if (!target) throw missing();
    if (
      target.role === 'owner' ||
      (a.role === 'manager' && (target.role === 'manager' || data.role === 'manager'))
    )
      throw new DomainError(
        'FORBIDDEN',
        'Only an owner can manage managers. Owner access is protected.',
        403,
      );
    await tx.$queryRaw`SELECT update_business_staff(${a.userId},${a.tenantId}::uuid,${a.businessId}::uuid,${a.branchId}::uuid,${data.userId},${data.role},${data.active})::text`;
    await audit(tx, a, 'staff.updated', a.businessId, JSON.stringify(data));
    return { id: data.userId };
  });
}

export const focusedWorkspace = (s: Scope) =>
  scoped(s, 'catalog.read', async (tx, a) => {
    const business = await tx.business.findUniqueOrThrow({ where: { id: a.businessId } });
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: business.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    if (a.role === 'cashier') {
      const session = await tx.cashSession.findFirst({
        where: { userId: a.userId, status: 'open' },
      });
      const sales = await tx.$queryRaw<
        { count: bigint; total: string }[]
      >`SELECT count(*) AS count,coalesce(sum(total),0)::text AS total FROM sales WHERE actor_id=${a.userId} AND (created_at AT TIME ZONE ${business.timezone})::date=${day}::date`;
      return json({
        register: session ? { status: session.status, openedAt: session.openedAt } : null,
        salesToday: Number(sales[0]!.count),
        revenueToday: sales[0]!.total,
      });
    }
    const lowStock = await tx.$queryRaw<
      { id: string; name: string; onHand: number }[]
    >`SELECT p.id,p.name,coalesce(b.on_hand,0)::float8 AS "onHand" FROM products p LEFT JOIN stock_balances b ON b.product_id=p.id WHERE NOT p.archived AND p.type='goods' AND coalesce(b.on_hand,0)<=p.low_stock ORDER BY p.name LIMIT 10`;
    return json({
      lowStock,
      pendingOrders: await tx.purchaseOrder.count({
        where: { status: { in: ['ordered', 'partially_received'] } },
      }),
      pendingCounts: await tx.stockCount.count({ where: { status: 'draft' } }),
    });
  });

export async function branchPerformance(s: Scope, from: string, to: string) {
  await scoped(s, 'finance.read', async () => true);
  const memberships = (await contexts(s.userId)).filter(
    (c) =>
      c.tenantId === s.tenantId && c.businessId === s.businessId && can(c.role, 'finance.read'),
  );
  const rows = [];
  for (const c of memberships) {
    const summary = (await financialReport({ ...s, branchId: c.branchId }, from, to)) as {
      revenue: string;
      grossProfit: string;
      expenses: string;
      netOperatingProfit: string;
    };
    rows.push({
      id: c.branchId,
      branchName: c.branchName,
      revenue: summary.revenue,
      grossProfit: summary.grossProfit,
      expenses: summary.expenses,
      netOperatingProfit: summary.netOperatingProfit,
    });
  }
  return { items: rows };
}
