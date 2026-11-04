import type { Prisma } from '@prisma/client';
import type { Scope } from '../../../packages/contracts/src/index.js';
import {
  purchaseEntrySchema,
  purchasePaymentSchema,
  receiptSchema,
} from '../../../packages/contracts/src/core.js';
import {
  DomainError,
  requirePermission,
  can,
  quantityUnits,
} from '../../../packages/domain/src/index.js';
import { scoped, write, audit, type Transaction } from './database.js';
import {
  saveSupplierInTransaction,
  savePurchaseInTransaction,
  receivePurchaseInTransaction,
  createBillInTransaction,
  settleInTransaction,
} from './core.js';
const json = (v: unknown): Prisma.JsonValue => JSON.parse(JSON.stringify(v)) as Prisma.JsonValue;
async function lockOrder(tx: Transaction, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'purchase:' + id},0))`;
  const order = await tx.purchaseOrder.findFirst({ where: { id } });
  if (!order) throw new DomainError('NOT_FOUND', 'Purchase not found in this branch.', 404);
  return order;
}
async function today(tx: Transaction, s: Scope) {
  const b = await tx.business.findUniqueOrThrow({ where: { id: s.businessId } });
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: b.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export function enterPurchase(s: Scope, key: string, input: unknown, id?: string) {
  const data = purchaseEntrySchema.parse(input);
  return write(s, 'purchase.create', 'purchase.entry', key, { id, data }, async (tx, a) => {
    if (data.mode === 'order') requirePermission(a.role, 'purchase.approve');
    let supplierId = data.supplierId;
    if (data.supplier) {
      requirePermission(a.role, 'supplier.create');
      supplierId = (await saveSupplierInTransaction(tx, a, data.supplier)).id;
    }
    const result = await savePurchaseInTransaction(
      tx,
      a,
      {
        supplierId: supplierId!,
        orderDate: data.orderDate,
        expectedDate: data.expectedDate,
        notes: data.notes,
        lines: data.lines,
      },
      id,
    );
    if (data.mode === 'order') {
      await tx.purchaseOrder.update({ where: { id: result.id }, data: { status: 'ordered' } });
      await audit(tx, a, 'purchase.order', result.id);
    }
    return result;
  });
}
async function ensureBills(tx: Transaction, a: Scope, orderId: string) {
  const receipts = await tx.goodsReceipt.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    }),
    date = await today(tx, a);
  for (const receipt of receipts) {
    if (
      receipt.total.isZero() ||
      (await tx.supplierBill.findFirst({ where: { receiptId: receipt.id } }))
    )
      continue;
    await createBillInTransaction(tx, a, {
      receiptId: receipt.id,
      reference: 'AUTO-' + receipt.number,
      billDate: date,
      dueDate: date,
    });
  }
}
export function receiveAndBill(s: Scope, key: string, id: string, input: unknown) {
  const data = receiptSchema.parse(input);
  return write(
    s,
    'purchase.receive',
    'purchase.receive_billed',
    key,
    { id, data },
    async (tx, a) => {
      await lockOrder(tx, id);
      const receipt = await receivePurchaseInTransaction(tx, a, data, id);
      await ensureBills(tx, a, id);
      return receipt;
    },
  );
}
export function payPurchase(s: Scope, key: string, id: string, input: unknown) {
  const data = purchasePaymentSchema.parse(input);
  return write(s, 'payable.manage', 'purchase.pay', key, { id, data }, async (tx, a) => {
    await lockOrder(tx, id);
    await ensureBills(tx, a, id);
    const bills = await tx.supplierBill.findMany({
      where: {
        receiptId: {
          in: (
            await tx.goodsReceipt.findMany({ where: { orderId: id }, select: { id: true } })
          ).map((r) => r.id),
        },
      },
      orderBy: { id: 'asc' },
    });
    // All payment paths lock the same bill key. Lock all before reading balances to
    // serialize purchase-wide allocations with legacy bill-payment endpoints.
    for (const bill of bills)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'bill:' + bill.id},0))`;
    const current = await tx.supplierBill.findMany({
        where: { id: { in: bills.map((b) => b.id) } },
        orderBy: { id: 'asc' },
      }),
      owed = current.reduce(
        (n, b) => n + BigInt(b.total.toString()) - BigInt(b.paid.toString()),
        0n,
      );
    let remaining = data.amount ? BigInt(data.amount) : owed;
    if (remaining <= 0n || remaining > owed)
      throw new DomainError(
        'INVALID_PAYMENT',
        'Choose an amount no greater than the amount owed for received items.',
        409,
      );
    const amount = remaining.toString(),
      payments = [];
    for (const bill of current) {
      const balance = BigInt(bill.total.toString()) - BigInt(bill.paid.toString()),
        allocation = remaining < balance ? remaining : balance;
      if (allocation <= 0n) continue;
      const payment = await settleInTransaction(
        tx,
        a,
        { amount: allocation.toString(), account: data.account, reference: data.reference },
        bill.id,
        'bill',
      );
      payments.push(payment.id);
      remaining -= allocation;
    }
    await audit(tx, a, 'purchase.paid', id, data.reference);
    return { id, amount, payments };
  });
}
export const purchaseWorkspace = (s: Scope, page = 1, search = '', selectedId?: string) =>
  scoped(s, 'purchase.read', async (tx, a) => {
    const where = {
      ...(selectedId ? { id: selectedId } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' as const } },
              {
                supplierId: {
                  in: (
                    await tx.supplier.findMany({
                      where: { name: { contains: search, mode: 'insensitive' } },
                    })
                  ).map((s) => s.id),
                },
              },
            ],
          }
        : {}),
    };
    const orders = await tx.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 30,
        skip: (page - 1) * 30,
      }),
      suppliers = await tx.supplier.findMany({ orderBy: { name: 'asc' } }),
      lines = await tx.purchaseLine.findMany({
        where: { orderId: { in: orders.map((o) => o.id) } },
      }),
      products = await tx.product.findMany({
        where: { id: { in: lines.map((l) => l.productId) } },
      }),
      receipts = await tx.goodsReceipt.findMany({
        where: { orderId: { in: orders.map((o) => o.id) } },
        orderBy: { createdAt: 'asc' },
      });
    const finance = can(a.role, 'payable.manage'),
      bills = finance ? await tx.supplierBill.findMany() : [],
      payments = finance
        ? await tx.financePayment.findMany({ where: { billId: { in: bills.map((b) => b.id) } } })
        : [];
    // Business-wide suppliers, branch-limited owed balances and histories; never widen RLS.
    const allReceipts = finance ? await tx.goodsReceipt.findMany() : [],
      allOrders = finance ? await tx.purchaseOrder.findMany() : [];
    const supplierOwed = (supplierId: string) =>
      finance
        ? (
            bills
              .filter((b) => b.supplierId === supplierId)
              .reduce((n, b) => n + BigInt(b.total.toString()) - BigInt(b.paid.toString()), 0n) +
            allReceipts
              .filter(
                (r) =>
                  !bills.some((b) => b.receiptId === r.id) &&
                  allOrders.some((o) => o.id === r.orderId && o.supplierId === supplierId),
              )
              .reduce((n, r) => n + BigInt(r.total.toString()), 0n)
          ).toString()
        : null;
    const pendingQuantities = await tx.$queryRaw<
      { supplierId: string; remaining: string }[]
    >`SELECT o.supplier_id AS "supplierId",sum(l.quantity-l.received)::text AS remaining FROM purchase_lines l JOIN purchase_orders o ON o.id=l.order_id WHERE o.status IN ('ordered','partially_received') GROUP BY o.supplier_id`;
    return json({
      total: await tx.purchaseOrder.count({ where }),
      suppliers: suppliers.map((s) =>
        can(a.role, 'supplier.read')
          ? {
              ...s,
              owed: supplierOwed(s.id),
              remainingQuantity:
                pendingQuantities.find((p) => p.supplierId === s.id)?.remaining ?? '0',
            }
          : { id: s.id, name: s.name, active: s.active },
      ),
      items: orders.map((o) => {
        const orderLines = lines.filter((l) => l.orderId === o.id),
          orderReceipts = receipts.filter((r) => r.orderId === o.id),
          orderBills = bills.filter((b) => orderReceipts.some((r) => r.id === b.receiptId)),
          paid = orderBills.reduce((n, b) => n + BigInt(b.paid.toString()), 0n),
          receivedValue = orderReceipts.reduce((n, r) => n + BigInt(r.total.toString()), 0n);
        return {
          ...o,
          supplierName: suppliers.find((s) => s.id === o.supplierId)?.name,
          orderedQuantity: orderLines
            .reduce((n, l) => n + quantityUnits(Number(l.quantity)), 0n)
            .toString(),
          receivedQuantity: orderLines
            .reduce((n, l) => n + quantityUnits(Number(l.received)), 0n)
            .toString(),
          receivedValue: receivedValue.toString(),
          paid: finance ? paid.toString() : null,
          owed: finance ? (receivedValue - paid).toString() : null,
          supplierOwed: supplierOwed(o.supplierId),
          lines: orderLines.map((l) => ({
            ...l,
            name: products.find((p) => p.id === l.productId)?.name,
            batchTracked: products.find((p) => p.id === l.productId)?.batchTracked,
            remaining:
              Number(quantityUnits(Number(l.quantity)) - quantityUnits(Number(l.received))) / 1000,
          })),
          receipts: orderReceipts,
          payments: payments.filter((p) => orderBills.some((b) => b.id === p.billId)),
        };
      }),
    });
  });
