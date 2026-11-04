import { randomUUID } from 'node:crypto';
import type {
  Scope,
  SaleInput,
  ReturnInput,
  Receipt,
  OfflineSaleInput,
} from '../../../packages/contracts/src/index.js';
import {
  DomainError,
  cashTotals,
  salePosting,
  lineAmount,
  allocatedCost,
  quantityUnits,
} from '../../../packages/domain/src/index.js';
import { scoped, write, audit, ownership, type Transaction } from './database.js';
import { postJournal } from './accounting.js';
import { verifyCatalogProof } from './offline-proof.js';
import { lockCash } from './cash.js';

export async function receipt(tx: Transaction, s: Scope, id: string): Promise<Receipt> {
  const sale = await tx.sale.findFirst({ where: { id } });
  if (!sale) throw new DomainError('NOT_FOUND', 'Sale not found in this branch.', 404);
  const lines = await tx.saleLine.findMany({ where: { saleId: id } }),
    returns = await tx.return.findMany({ where: { saleId: id } }),
    business = await tx.business.findUniqueOrThrow({
      where: { id: s.businessId },
    }),
    branch = await tx.branch.findUniqueOrThrow({ where: { id: s.branchId } });
  const returned = await tx.returnLine.findMany({
    where: { returnId: { in: returns.map((r) => r.id) } },
  });
  const payment = await tx.payment.findFirst({
    where: { saleId: id, direction: 'in' },
    orderBy: { createdAt: 'asc' },
  });
  const reviewRequired = !!(await tx.stockDiscrepancy.findFirst({
    where: { saleId: id, status: { not: 'resolved' } },
  }));
  return {
    offline: sale.offline,
    syncedAt: sale.syncedAt.toISOString(),
    reviewRequired,
    valuationPending: sale.valuationPending,
    payment: payment
      ? {
          method: payment.method,
          provider: payment.provider,
          reference: payment.reference,
          status: payment.status,
        }
      : undefined,
    id,
    number: sale.number,
    createdAt: sale.createdAt.toISOString(),
    total: sale.total.toString(),
    tendered: sale.tendered.toString(),
    change: sale.change.toString(),
    customerName: sale.customerName,
    branchName: branch.name,
    businessName: business.name,
    currency: business.currency,
    returnedTotal: returns.reduce((n, r) => n + BigInt(r.total.toString()), 0n).toString(),
    lines: lines.map((l) => ({
      id: l.id,
      name: l.name,
      sku: l.sku,
      quantity: Number(l.quantity),
      unitPrice: l.unitPrice.toString(),
      total: l.total.toString(),
      returned: Number(
        returned
          .filter((r) => r.saleLineId === l.id)
          .reduce((n, r) => n + Number(r.quantity), 0)
          .toFixed(3),
      ),
    })),
  };
}
export async function finalizeSale(
  s: Scope,
  key: string,
  input: SaleInput,
  offline?: OfflineSaleInput,
): Promise<{ id: string }> {
  return write(
    s,
    'sale.create',
    offline ? 'sale.offline' : 'sale.complete',
    key,
    offline ?? input,
    (tx, a) => postSale(tx, a, key, input, offline),
  );
}
export async function postSale(
  tx: Transaction,
  a: Scope,
  key: string,
  input: SaleInput,
  offline?: OfflineSaleInput,
): Promise<{ id: string }> {
  let closedRegister = false;
  if (offline) {
    if (
      offline.saleId !== key ||
      offline.userId !== a.userId ||
      offline.tenantId !== a.tenantId ||
      offline.businessId !== a.businessId ||
      offline.branchId !== a.branchId
    )
      throw new DomainError(
        'OFFLINE_IDENTITY_MISMATCH',
        'This sale belongs to a different identity or business.',
        403,
      );
    const device = await tx.offlineDevice.findFirst({
      where: { id: offline.deviceId, userId: a.userId, active: true },
    });
    if (!device)
      throw new DomainError('DEVICE_BLOCKED', 'Register this device online before uploading.', 403);
    for (const line of offline.lines) verifyCatalogProof(a, offline, line);
    const localTime = new Date(offline.localTime);
    if (localTime > new Date(Date.now() + 300000) || new Date(offline.lastSyncedAt) > localTime)
      throw new DomainError('INVALID_TIME', 'Review the device clock.');
    const session = await tx.cashSession.findFirst({
      where: { id: input.cashSessionId, userId: a.userId },
    });
    if (
      !session ||
      localTime < session.openedAt ||
      (session.closedAt && localTime > session.closedAt)
    )
      throw new DomainError(
        'INVALID_OFFLINE_REGISTER',
        'The recorded sale time is outside this register session.',
        409,
      );
    closedRegister = session.status === 'closed';
    const business = await tx.business.findUniqueOrThrow({ where: { id: a.businessId } });
    if (offline.lines.some((l) => l.quantity > Math.max(0, l.lastKnownStock))) {
      if (offline.reason.trim().length < 3)
        throw new DomainError('REASON_REQUIRED', 'Explain selling beyond the local estimate.');
      if (business.offlinePolicy === 'manager_override' && !['owner', 'manager'].includes(a.role))
        throw new DomainError(
          'MANAGER_REQUIRED',
          'This business requires a manager to authorize sales beyond the estimate.',
          403,
        );
    }
  } else await lockCash(tx, a, input.cashSessionId);
  const customer = input.customerId
    ? await tx.customer.findFirst({
        where: { id: input.customerId, archived: false },
      })
    : null;
  if (input.customerId && !customer) throw new DomainError('NOT_FOUND', 'Customer not found.', 404);
  // Stable lock order prevents deadlocks between carts containing the same products.
  const lines = [];
  for (const item of [...input.lines].sort((x, y) => x.productId.localeCompare(y.productId))) {
    const p = await tx.product.findFirst({
      where: { id: item.productId, ...(offline ? {} : { archived: false }) },
    });
    if (!p)
      throw new DomainError(
        'PRODUCT_UNAVAILABLE',
        'A product in this cart is no longer available.',
        409,
      );
    let cost = 0n,
      opening = 0,
      shortage = 0;
    const captured = offline?.lines.find((l) => l.productId === p.id);
    if (p.type === 'goods') {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'stock:' + a.branchId + ':' + p.id},0))`;
      const b = await tx.stockBalance.findFirst({ where: { productId: p.id } });
      opening = Number(b?.onHand ?? 0);
      if (!offline && item.quantity > Math.max(0, opening))
        throw new DomainError(
          'INSUFFICIENT_STOCK',
          `Not enough stock for ${p.name}. Your cart has been preserved.`,
          409,
        );
      const valuedQuantity = Math.min(item.quantity, Math.max(0, opening));
      if (valuedQuantity > 0 && b)
        cost = allocatedCost(b.value.toString(), valuedQuantity, opening);
      shortage = Number((item.quantity - valuedQuantity).toFixed(3));
      await tx.stockBalance.upsert({
        where: { tenantId_businessId_branchId_productId: { ...ownership(a), productId: p.id } },
        create: {
          id: randomUUID(),
          ...ownership(a),
          productId: p.id,
          onHand: -item.quantity,
          value: '0',
        },
        update: { onHand: { decrement: item.quantity }, value: { decrement: cost.toString() } },
      });
    }
    const unitPrice = captured?.unitPrice ?? p.price.toString();
    const discount = captured?.discount ?? '0';
    const lineTotal = (lineAmount(unitPrice, item.quantity) - BigInt(discount)).toString();
    if (BigInt(lineTotal) < 0n || (captured && lineTotal !== captured.total))
      throw new DomainError('INVALID_OFFLINE_TOTAL', 'Review the recorded line totals.');
    lines.push({
      p,
      quantity: item.quantity,
      cost,
      opening,
      shortage,
      unitPrice,
      discount,
      lineTotal,
      captured,
    });
  }
  const totals = cashTotals(
    lines.map((l) => ({ price: l.lineTotal, quantity: 1 })),
    input.tendered,
  );
  if (offline && offline.total !== totals.total)
    throw new DomainError('INVALID_OFFLINE_TOTAL', 'The sale total differs from its lines.');
  const id = offline?.saleId ?? randomUUID(),
    cost = lines.reduce((n, l) => n + l.cost, 0n).toString();
  // Sequence gaps are allowed and never reused; number allocation is concurrency-safe.
  const seq = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('document_sequence') AS n`;
  const number = `SL-${String(seq[0]?.n).padStart(6, '0')}`;
  await tx.sale.create({
    data: {
      id,
      ...ownership(a),
      number,
      offline: !!offline,
      deviceId: offline?.deviceId,
      createdAt: offline ? new Date(offline.localTime) : undefined,
      valuationPending: lines.some((l) => l.shortage > 0),
      actorId: a.userId,
      customerId: customer?.id,
      customerName: customer?.name,
      cashSessionId: input.cashSessionId,
      total: totals.total,
      tendered: input.tendered,
      change: totals.change,
      cost,
    },
  });
  for (const l of lines) {
    await tx.saleLine.create({
      data: {
        id: randomUUID(),
        ...ownership(a),
        saleId: id,
        productId: l.p.id,
        name: l.captured?.name ?? l.p.name,
        sku: l.captured?.sku ?? l.p.sku,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
        total: l.lineTotal,
        cost: l.cost.toString(),
      },
    });
    if (l.p.type === 'goods')
      await tx.stockMovement.create({
        data: {
          id: randomUUID(),
          ...ownership(a),
          productId: l.p.id,
          quantity: -l.quantity,
          value: (-l.cost).toString(),
          sourceType: 'sale',
          sourceId: id,
          reason: offline
            ? 'Recorded offline sale; shortage costs pending review'
            : 'Completed sale',
          createdAt: offline ? new Date(offline.localTime) : undefined,
          actorId: a.userId,
        },
      });
  }
  for (const l of lines)
    if (l.shortage > 0) {
      await tx.stockDiscrepancy.create({
        data: {
          id: randomUUID(),
          ...ownership(a),
          saleId: id,
          productId: l.p.id,
          opening: l.opening,
          shortage: l.shortage,
          localEstimate: l.captured?.lastKnownStock ?? l.opening,
        },
      });
    }
  if (closedRegister)
    await audit(
      tx,
      a,
      'offline.closed_register_review',
      id,
      'Late upload changes the expected cash of a closed session.',
    );
  const payment = offline?.payment ?? input.payment ?? { method: 'cash' as const };
  await tx.payment.create({
    data: {
      id: randomUUID(),
      ...ownership(a),
      saleId: id,
      cashSessionId: input.cashSessionId,
      amount: totals.total,
      direction: 'in',
      method: payment.method,
      provider: payment.provider,
      reference: payment.reference,
      status: payment.method === 'cash' ? 'confirmed' : 'recorded_unverified',
      createdAt: offline ? new Date(offline.localTime) : undefined,
    },
  });
  const postings = salePosting(totals.total, cost);
  if (payment.method !== 'cash') postings[0]!.account = '1100 Payments awaiting verification';
  await postJournal(tx, a, 'sale', id, postings);
  await audit(tx, a, 'sale.completed', id);
  return { id };
}
export async function returnSale(
  s: Scope,
  key: string,
  saleId: string,
  input: ReturnInput,
): Promise<{ id: string; total: string }> {
  return write(s, 'sale.refund', 'sale.return', key, { saleId, ...input }, async (tx, a) => {
    await lockCash(tx, a, input.cashSessionId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'return:' + saleId},0))`;
    const originalSale = await tx.sale.findFirst({ where: { id: saleId } });
    if (!originalSale) throw new DomainError('NOT_FOUND', 'Sale not found in this branch.', 404);
    const id = randomUUID();
    let total = 0n,
      cost = 0n,
      restockedCost = 0n,
      damagedCost = 0n;
    const lines = [];
    for (const line of input.lines) {
      const original = await tx.saleLine.findFirst({
        where: { id: line.saleLineId, saleId },
      });
      if (!original) throw new DomainError('NOT_FOUND', 'Original sale line not found.', 404);
      const prior = await tx.returnLine.findMany({
        where: { saleLineId: original.id },
      });
      const used = Number(prior.reduce((n, r) => n + Number(r.quantity), 0).toFixed(3));
      if (
        quantityUnits(line.quantity) >
        quantityUnits(Number(original.quantity)) - quantityUnits(used)
      )
        throw new DomainError(
          'RETURN_EXCEEDS_SALE',
          'The return exceeds the remaining eligible quantity.',
          409,
        );
      const priorCost = prior.reduce((n, r) => n + BigInt(r.cost.toString()), 0n);
      const allocatedCost =
        (BigInt(original.cost.toString()) *
          quantityUnits(Number((used + line.quantity).toFixed(3)))) /
          quantityUnits(Number(original.quantity)) -
        priorCost;
      const lineTotal =
        (BigInt(original.total.toString()) *
          quantityUnits(Number((used + line.quantity).toFixed(3)))) /
          quantityUnits(Number(original.quantity)) -
        prior.reduce((n, r) => n + BigInt(r.total.toString()), 0n);
      total += lineTotal;
      cost += allocatedCost;
      const p = await tx.product.findUniqueOrThrow({
        where: { id: original.productId },
      });
      if (p.type === 'goods' && line.disposition === 'restockable') {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'stock:' + a.branchId + ':' + p.id},0))`;
        const balance = await tx.stockBalance.findFirst({ where: { productId: p.id } });
        if (Number(balance?.onHand ?? 0) < 0 && allocatedCost > 0n)
          throw new DomainError(
            'SHORTAGE_REVIEW_REQUIRED',
            'Record a reviewed quantity correction before returning valued goods against a negative balance.',
            409,
          );
        await tx.stockBalance.upsert({
          where: {
            tenantId_businessId_branchId_productId: {
              ...ownership(a),
              productId: p.id,
            },
          },
          create: {
            id: randomUUID(),
            ...ownership(a),
            productId: p.id,
            onHand: line.quantity,
            value: allocatedCost.toString(),
          },
          update: {
            onHand: { increment: line.quantity },
            value: { increment: allocatedCost.toString() },
          },
        });
        await tx.stockMovement.create({
          data: {
            id: randomUUID(),
            ...ownership(a),
            productId: p.id,
            quantity: line.quantity,
            value: allocatedCost.toString(),
            sourceType: 'return',
            sourceId: id,
            reason: input.reason,
            actorId: a.userId,
          },
        });
        restockedCost += allocatedCost;
      } else {
        damagedCost += allocatedCost;
      }
      lines.push({
        ...line,
        total: lineTotal.toString(),
        cost: allocatedCost.toString(),
      });
    }
    await tx.return.create({
      data: {
        id,
        ...ownership(a),
        saleId,
        cashSessionId: input.cashSessionId,
        total: total.toString(),
        cost: cost.toString(),
        reason: input.reason,
        actorId: a.userId,
      },
    });
    await tx.returnLine.createMany({
      data: lines.map((l) => ({
        id: randomUUID(),
        ...ownership(a),
        returnId: id,
        ...l,
      })),
    });
    const originalPayment = await tx.payment.findFirst({ where: { saleId, direction: 'in' } });
    await tx.payment.create({
      data: {
        id: randomUUID(),
        ...ownership(a),
        method: originalPayment?.method ?? 'cash',
        provider: originalPayment?.provider,
        reference: originalPayment?.reference,
        status: originalPayment?.status ?? 'confirmed',
        saleId,
        returnId: id,
        cashSessionId: input.cashSessionId,
        amount: total.toString(),
        direction: 'out',
      },
    });
    const postings = [
      { account: '4000 Sales', debit: total.toString(), credit: '0' },
      {
        account:
          originalPayment?.method && originalPayment.method !== 'cash'
            ? '1100 Payments awaiting verification'
            : '1000 Cash',
        debit: '0',
        credit: total.toString(),
      },
    ];
    if (restockedCost > 0n)
      postings.push({
        account: '1200 Inventory',
        debit: restockedCost.toString(),
        credit: '0',
      });
    if (damagedCost > 0n)
      postings.push({
        account: '5100 Damaged goods',
        debit: damagedCost.toString(),
        credit: '0',
      });
    if (cost > 0n)
      postings.push({
        account: '5000 Cost of sales',
        debit: '0',
        credit: cost.toString(),
      });
    await postJournal(tx, a, 'return', id, postings);
    await audit(tx, a, 'sale.returned', id, input.reason);
    return { id, total: total.toString() };
  });
}
export const getReceipt = (s: Scope, id: string) =>
  scoped(s, 'sale.read', (tx, a) => receipt(tx, a, id));
export const listSales = (s: Scope, search: string, page: number, limit: number) =>
  scoped(s, 'sale.read', async (tx, a) => {
    const where = {
      ...ownership(a),
      OR: [
        { number: { contains: search, mode: 'insensitive' as const } },
        { customerName: { contains: search, mode: 'insensitive' as const } },
      ],
    };
    const rows = await tx.sale.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: { createdAt: 'desc' },
      }),
      total = await tx.sale.count({ where });
    const items = [];
    for (const row of rows) items.push(await receipt(tx, a, row.id));
    return { items, total };
  });
