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
import { changeBatches, restoreLots, includedTax } from './stock-lots.js';
import { z } from 'zod';
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
    tax: lines.reduce((n, l) => n + BigInt(l.tax.toString()), 0n).toString(),
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
  booking?: { roomCharge?: boolean; restaurant?: boolean },
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
  } else if (!booking?.roomCharge) await lockCash(tx, a, input.cashSessionId);
  const customer = input.customerId
    ? await tx.customer.findFirst({
        where: { id: input.customerId, archived: false },
      })
    : null;
  if (input.customerId && !customer) throw new DomainError('NOT_FOUND', 'Customer not found.', 404);
  // Lock every direct product and captured recipe ingredient in a single stable order.
  const snapshots = await tx.product.findMany({
    where: { id: { in: input.lines.map((l) => l.productId) } },
  });
  const stockIds = new Set<string>();
  for (const p of snapshots) {
    if (p.type === 'goods') stockIds.add(p.id);
    for (const l of recipeSnapshot.parse(p.recipe)) stockIds.add(l.productId);
  }
  for (const productId of [...stockIds].sort())
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'stock:' + a.branchId + ':' + productId},0))`;
  const lines = [];
  for (const item of [...input.lines].sort((x, y) => x.productId.localeCompare(y.productId))) {
    const p = snapshots.find((p) => p.id === item.productId && (offline || !p.archived));
    if (!p || p.isGroup || p.systemKind)
      throw new DomainError(
        'PRODUCT_UNAVAILABLE',
        'A product in this cart is no longer available.',
        409,
      );
    if (offline && p.batchTracked)
      throw new DomainError(
        'BATCH_ONLINE_REQUIRED',
        'Products with expiry require online checkout so their current lots can be checked.',
        409,
      );
    let cost = 0n,
      opening = 0,
      shortage = 0;
    const captured = offline?.lines.find((l) => l.productId === p.id);
    const consumption: Consumption[] = [];
    const recipe = recipeSnapshot.parse(p.recipe);
    if (recipe.length && p.type === 'goods')
      throw new DomainError('INVALID_RECIPE', 'A recipe menu item must be a service.');
    const parts = recipe.length
      ? recipe.map((x) => ({
          productId: x.productId,
          quantity: exactIngredientQuantity(x.quantity, item.quantity),
        }))
      : p.type === 'goods'
        ? [{ productId: p.id, quantity: item.quantity }]
        : [];
    for (const part of parts.sort((x, y) => x.productId.localeCompare(y.productId))) {
      if (
        part.quantity <= 0 ||
        Math.abs(part.quantity * 1000 - Math.round(part.quantity * 1000)) > 0.000001
      )
        throw new DomainError('INVALID_QUANTITY', 'Ingredient quantity must be at least 0.001.');
      const ingredient =
        part.productId === p.id
          ? p
          : await tx.product.findFirst({
              where: { id: part.productId, archived: false, type: 'goods', isGroup: false },
            });
      if (!ingredient)
        throw new DomainError('PRODUCT_UNAVAILABLE', 'A recipe ingredient is unavailable.', 409);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'stock:' + a.branchId + ':' + ingredient.id},0))`;
      const b = await tx.stockBalance.findFirst({ where: { productId: ingredient.id } });
      const available = Number(b?.onHand ?? 0);
      if (
        (!offline || recipe.length > 0 || ingredient.batchTracked) &&
        part.quantity > Math.max(0, available)
      )
        throw new DomainError(
          'INSUFFICIENT_STOCK',
          `Not enough stock for ${ingredient.name}. Your cart has been preserved.`,
          409,
        );
      const valued = Math.min(part.quantity, Math.max(0, available));
      const value = valued > 0 && b ? allocatedCost(b.value.toString(), valued, available) : 0n;
      const lots = await changeBatches(
        tx,
        a,
        ingredient,
        -part.quantity,
        undefined,
        false,
        offline ? new Date(offline.localTime) : new Date(),
      );
      await tx.stockBalance.upsert({
        where: {
          tenantId_businessId_branchId_productId: { ...ownership(a), productId: ingredient.id },
        },
        create: {
          id: randomUUID(),
          ...ownership(a),
          productId: ingredient.id,
          onHand: -part.quantity,
          value: '0',
        },
        update: { onHand: { decrement: part.quantity }, value: { decrement: value.toString() } },
      });
      consumption.push({
        productId: ingredient.id,
        quantity: part.quantity,
        cost: value.toString(),
        lots,
      });
      cost += value;
      if (ingredient.id === p.id) {
        opening = available;
        shortage = Number((part.quantity - valued).toFixed(3));
      }
    }
    const unitPrice = captured?.unitPrice ?? p.price.toString();
    const discount = captured?.discount ?? '0';
    const lineTotal = (lineAmount(unitPrice, item.quantity) - BigInt(discount)).toString();
    if (BigInt(lineTotal) < 0n || (captured && lineTotal !== captured.total))
      throw new DomainError('INVALID_OFFLINE_TOTAL', 'Review the recorded line totals.');
    lines.push({
      p,
      consumption,
      tax: includedTax(
        lineTotal,
        offline && captured ? verifyCatalogProof(a, offline, captured) : p.vatBps,
      ),
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
    booking?.roomCharge
      ? lines.reduce((n, l) => n + BigInt(l.lineTotal), 0n).toString()
      : input.tendered,
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
      cashSessionId: booking?.roomCharge ? null : input.cashSessionId,
      settlementKind: booking?.roomCharge ? 'room' : 'paid',
      revenueAccount: booking?.restaurant ? '4010 Restaurant sales' : '4000 Sales',
      total: totals.total,
      tendered: booking?.roomCharge ? '0' : input.tendered,
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
        consumption: l.consumption,
        tax: l.tax.toString(),
      },
    });
    for (const part of l.consumption)
      await tx.stockMovement.create({
        data: {
          id: randomUUID(),
          ...ownership(a),
          productId: part.productId,
          quantity: -part.quantity,
          value: (-BigInt(part.cost)).toString(),
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
  if (!booking?.roomCharge)
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
  const tax = lines.reduce((n, l) => n + l.tax, 0n);
  const postings = salePosting(totals.total, cost);
  postings[1]!.credit = (BigInt(totals.total) - tax).toString();
  if (tax > 0n) postings.push({ account: '2200 VAT payable', debit: '0', credit: tax.toString() });
  if (payment.method !== 'cash') postings[0]!.account = '1100 Payments awaiting verification';
  if (booking?.roomCharge) postings[0]!.account = '1400 Guest room charges';
  if (booking?.restaurant) postings[1]!.account = '4010 Restaurant sales';
  await postJournal(
    tx,
    a,
    'sale',
    id,
    postings.filter((l) => l.debit !== '0' || l.credit !== '0'),
  );
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
    if (originalSale?.settlementKind === 'room')
      throw new DomainError(
        'ROOM_CREDIT_REQUIRED',
        'Room charges need a guest credit review, not a cash refund.',
        409,
      );
    if (!originalSale) throw new DomainError('NOT_FOUND', 'Sale not found in this branch.', 404);
    const originalLines = await tx.saleLine.findMany({
      where: { saleId, id: { in: input.lines.map((l) => l.saleLineId) } },
    });
    const stockIds = new Set<string>();
    for (const l of originalLines) {
      const consumed = consumptionSchema.parse(l.consumption);
      if (consumed.length) for (const p of consumed) stockIds.add(p.productId);
      else stockIds.add(l.productId);
    }
    for (const p of [...stockIds].sort())
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'stock:' + a.branchId + ':' + p},0))`;
    const id = randomUUID();
    let total = 0n,
      cost = 0n,
      restockedCost = 0n,
      damagedCost = 0n,
      tax = 0n;
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
      const lineTax =
        (BigInt(original.tax.toString()) *
          quantityUnits(Number((used + line.quantity).toFixed(3)))) /
          quantityUnits(Number(original.quantity)) -
        prior.reduce((n, r) => n + BigInt(r.tax.toString()), 0n);
      tax += lineTax;
      const p = await tx.product.findUniqueOrThrow({ where: { id: original.productId } });
      const captured = consumptionSchema.parse(original.consumption);
      const parts = captured.length
        ? captured
        : p.type === 'goods'
          ? [
              {
                productId: p.id,
                quantity: Number(original.quantity),
                cost: original.cost.toString(),
                lots: [],
              },
            ]
          : [];
      let restored = 0n;
      if (line.disposition === 'restockable')
        for (const part of parts) {
          const originalUnits = quantityUnits(Number(original.quantity)),
            partUnits = quantityUnits(part.quantity),
            previous = quantityUnits(used),
            next = previous + quantityUnits(line.quantity);
          if (
            (partUnits * next) % originalUnits !== 0n ||
            (partUnits * previous) % originalUnits !== 0n
          )
            throw new DomainError(
              'RETURN_PRECISION',
              'Return a quantity that restores whole thousandths of each captured ingredient.',
            );
          const q = Number((partUnits * (next - previous)) / originalUnits) / 1000;
          const value =
            (BigInt(part.cost) * next) / originalUnits -
            (BigInt(part.cost) * previous) / originalUnits;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'stock:' + a.branchId + ':' + part.productId},0))`;
          const balance = await tx.stockBalance.findFirst({ where: { productId: part.productId } });
          if (Number(balance?.onHand ?? 0) < 0 && value > 0n)
            throw new DomainError(
              'SHORTAGE_REVIEW_REQUIRED',
              'Review the shortage before restoring valued stock.',
              409,
            );
          await tx.stockBalance.upsert({
            where: {
              tenantId_businessId_branchId_productId: {
                ...ownership(a),
                productId: part.productId,
              },
            },
            create: {
              id: randomUUID(),
              ...ownership(a),
              productId: part.productId,
              onHand: q,
              value: value.toString(),
            },
            update: { onHand: { increment: q }, value: { increment: value.toString() } },
          });
          await restoreLots(
            tx,
            part.lots,
            q,
            Number((partUnits * previous) / originalUnits) / 1000,
            part.quantity,
          );
          await tx.stockMovement.create({
            data: {
              id: randomUUID(),
              ...ownership(a),
              productId: part.productId,
              quantity: q,
              value: value.toString(),
              sourceType: 'return',
              sourceId: id,
              reason: input.reason,
              actorId: a.userId,
            },
          });
          restored += value;
        }
      // Individual component rounding can differ by one BIF from the aggregate. Allocate
      // refunds from the same captured component totals so inventory and COGS stay exact.
      const returnCost = parts.length
        ? parts.reduce(
            (n, part) =>
              n +
              (BigInt(part.cost) * quantityUnits(Number((used + line.quantity).toFixed(3)))) /
                quantityUnits(Number(original.quantity)) -
              (BigInt(part.cost) * quantityUnits(used)) / quantityUnits(Number(original.quantity)),
            0n,
          )
        : allocatedCost;
      cost += returnCost - allocatedCost;
      if (line.disposition === 'restockable') {
        restockedCost += restored;
      } else damagedCost += returnCost;
      lines.push({
        ...line,
        total: lineTotal.toString(),
        cost: returnCost.toString(),
        tax: lineTax.toString(),
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
      { account: originalSale.revenueAccount, debit: (total - tax).toString(), credit: '0' },
      {
        account:
          originalPayment?.method && originalPayment.method !== 'cash'
            ? '1100 Payments awaiting verification'
            : '1000 Cash',
        debit: '0',
        credit: total.toString(),
      },
    ];
    if (tax > 0n)
      postings.push({ account: '2200 VAT payable', debit: tax.toString(), credit: '0' });
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
    await postJournal(
      tx,
      a,
      'return',
      id,
      postings.filter((l) => l.debit !== '0' || l.credit !== '0'),
    );
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

const recipeSnapshot = z.array(
  z.object({ productId: z.string().uuid(), quantity: z.number().positive() }),
);
const consumptionSchema = z.array(
  z.object({
    productId: z.string().uuid(),
    quantity: z.number().positive(),
    cost: z.string(),
    lots: z.array(z.object({ id: z.string().uuid(), quantity: z.number().positive() })),
  }),
);
type Consumption = z.infer<typeof consumptionSchema>[number];

function exactIngredientQuantity(perItem: number, quantity: number) {
  const units = quantityUnits(perItem) * quantityUnits(quantity);
  if (units % 1000n !== 0n)
    throw new DomainError(
      'RECIPE_PRECISION',
      'Choose a quantity that uses whole thousandths of each ingredient.',
    );
  return Number(units / 1000n) / 1000;
}
