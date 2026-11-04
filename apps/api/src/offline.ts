import { randomUUID } from 'node:crypto';
import type { OfflineSaleInput, Scope } from '../../../packages/contracts/src/index.js';
import { DomainError } from '../../../packages/domain/src/index.js';
import { audit, ownership, scoped, write } from './database.js';
import { listProducts } from './catalog.js';
import { catalogProof } from './offline-proof.js';
import { finalizeSale } from './sales.js';

const manager = (s: Scope) => {
  if (!['owner', 'manager'].includes(s.role))
    throw new DomainError('FORBIDDEN', 'A manager must review inventory discrepancies.', 403);
};
export const registerDevice = (s: Scope, id: string) =>
  write(s, 'sale.create', 'device.register', id, { id }, async (tx, a) => {
    const prior = await tx.offlineDevice.findFirst({ where: { id } });
    if (prior && (prior.userId !== a.userId || !prior.active))
      throw new DomainError('DEVICE_BLOCKED', 'This device registration is unavailable.', 403);
    if (!prior) await tx.offlineDevice.create({ data: { id, ...ownership(a), userId: a.userId } });
    const business = await tx.business.findUniqueOrThrow({ where: { id: a.businessId } });
    return { id, offlinePolicy: business.offlinePolicy };
  });
export async function ingestOfflineSale(s: Scope, input: OfflineSaleInput) {
  const result = await finalizeSale(
    s,
    input.saleId,
    {
      lines: input.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      tendered: input.tendered,
      cashSessionId: input.cashSessionId,
      customerId: input.customerId,
      payment: input.payment,
    },
    input,
  );
  return scoped(s, 'sale.create', async (tx) => ({
    id: result.id,
    reviewRequired:
      !!(await tx.stockDiscrepancy.findFirst({
        where: { saleId: result.id, status: { not: 'resolved' } },
      })) ||
      !!(await tx.auditEvent.findFirst({
        where: { entityId: result.id, action: 'offline.closed_register_review' },
      })),
  }));
}
export const reconciliation = (s: Scope) =>
  scoped(s, 'catalog.read', async (tx, a) => {
    manager(a);
    const rows = await tx.stockDiscrepancy.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    const items = [];
    for (const r of rows) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: r.productId } });
      const movements = await tx.stockMovement.findMany({
        where: { productId: r.productId },
        orderBy: { createdAt: 'asc' },
      });
      const sales = await tx.saleLine.findMany({ where: { productId: r.productId } });
      const related = await tx.sale.findMany({ where: { id: { in: sales.map((l) => l.saleId) } } });
      items.push({
        returns: await tx.return.findMany({
          where: { saleId: r.saleId },
          select: { id: true, reason: true, createdAt: true },
        }),
        ...r,
        opening: Number(r.opening),
        shortage: Number(r.shortage),
        localEstimate: Number(r.localEstimate),
        productName: product.name,
        onHand: Number(
          (await tx.stockBalance.findFirst({ where: { productId: r.productId } }))?.onHand ?? 0,
        ),
        openingAvailability: movements
          .filter((m) => m.sourceType === 'opening' || m.sourceType === 'demo_opening')
          .reduce((n, m) => n + Number(m.quantity), 0),
        sales: sales.map((l) => ({
          id: l.saleId,
          quantity: Number(l.quantity),
          number: related.find((s) => s.id === l.saleId)?.number,
          offline: related.find((s) => s.id === l.saleId)?.offline,
          createdAt: related.find((s) => s.id === l.saleId)?.createdAt,
        })),
        events: await tx.reconciliationEvent.findMany({
          where: { discrepancyId: r.id },
          orderBy: { createdAt: 'asc' },
        }),
        valuationPending: related.find((s) => s.id === r.saleId)?.valuationPending,
      });
    }
    return { items };
  });
export const resolveDiscrepancy = (
  s: Scope,
  key: string,
  id: string,
  input: {
    action:
      | 'stock_adjustment'
      | 'missing_delivery'
      | 'refund'
      | 'sale_correction'
      | 'cancellation'
      | 'outstanding_fulfillment';
    reason: string;
    referenceId?: string;
    quantity?: number;
  },
) =>
  write(s, 'catalog.read', 'stock.reconcile', key, { id, ...input }, async (tx, a) => {
    manager(a);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'discrepancy:' + id},0))`;
    const r = await tx.stockDiscrepancy.findFirst({ where: { id } });
    if (!r) throw new DomainError('NOT_FOUND', 'Discrepancy not found.', 404);
    let referenceId = input.referenceId,
      status = 'resolved';
    if (input.action === 'stock_adjustment' || input.action === 'missing_delivery') {
      // Reviewed quantity evidence only. No invented unit cost, equity or expense is posted.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'stock:' + a.branchId + ':' + r.productId},0))`;
      const b = await tx.stockBalance.findFirst({ where: { productId: r.productId } });
      if (!b || !input.quantity || input.quantity > Math.max(0, -Number(b.onHand)))
        throw new DomainError(
          'INVALID_CORRECTION',
          'Enter a positive evidenced quantity no greater than the recorded deficit. Enter valued surplus through Update stock.',
        );
      referenceId = randomUUID();
      await tx.stockBalance.update({
        where: { id: b.id },
        data: { onHand: { increment: input.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          id: referenceId,
          ...ownership(a),
          productId: r.productId,
          quantity: input.quantity,
          value: '0',
          sourceType: 'shortage_quantity_correction',
          sourceId: r.id,
          reason: input.reason,
          actorId: a.userId,
        },
      });
      if (Number(b.onHand) + input.quantity < 0) status = 'open';
    } else if (input.action === 'outstanding_fulfillment') status = 'outstanding_fulfillment';
    else {
      const correction = referenceId
        ? await tx.return.findFirst({ where: { id: referenceId, saleId: r.saleId } })
        : null;
      if (!correction)
        throw new DomainError(
          'CORRECTION_REQUIRED',
          'First record the refund or sale reversal on the original receipt, then link its return ID here.',
        );
      const returned = await tx.returnLine.findMany({ where: { returnId: correction.id } });
      const original = await tx.saleLine.findMany({
        where: { saleId: r.saleId, productId: r.productId },
      });
      if (!returned.some((l) => original.some((o) => o.id === l.saleLineId)))
        throw new DomainError(
          'INVALID_CORRECTION',
          'The linked return does not correct the affected product.',
        );
      const corrected = returned
        .filter((l) => original.some((o) => o.id === l.saleLineId))
        .reduce((n, l) => n + Number(l.quantity), 0);
      if (corrected < Number(r.shortage)) status = 'open';
    }
    await tx.reconciliationEvent.create({
      data: {
        id: randomUUID(),
        ...ownership(a),
        discrepancyId: id,
        actorId: a.userId,
        action: input.action,
        reason: input.reason,
        referenceId,
      },
    });
    await tx.stockDiscrepancy.update({ where: { id }, data: { status } });
    await audit(tx, a, 'stock.reconciled', id, input.reason);
    return { id, status, valuationPending: true };
  });

export const offlineCatalog = (s: Scope, deviceId: string) =>
  scoped(s, 'sale.create', async (tx, a) => {
    const device = await tx.offlineDevice.findFirst({
      where: { id: deviceId, userId: a.userId, active: true },
    });
    if (!device)
      throw new DomainError(
        'DEVICE_BLOCKED',
        'Register this device before downloading its offline catalog.',
        403,
      );
    const catalog = await listProducts(tx, a, '', 1, 100);
    const syncedAt = new Date().toISOString();
    return {
      syncedAt,
      items: catalog.items.map((p) => ({
        ...p,
        offlineProof: catalogProof(a, deviceId, p, syncedAt),
      })),
    };
  });
