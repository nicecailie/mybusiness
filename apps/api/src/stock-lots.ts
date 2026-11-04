import { randomUUID } from 'node:crypto';
import type { Scope } from '../../../packages/contracts/src/index.js';
import { DomainError, quantityUnits } from '../../../packages/domain/src/index.js';
import { ownership, type Transaction } from './database.js';
export type Lot = { id: string; quantity: number };
// Call while holding the common stock lock. Lots track quantity; StockBalance owns valuation.
export async function changeBatches(
  tx: Transaction,
  a: Scope,
  p: { id: string; batchTracked: boolean },
  quantity: number,
  expiresOn?: string,
  allowExpired = false,
  at = new Date(),
): Promise<Lot[]> {
  if (!p.batchTracked) return [];
  if (quantity > 0) {
    if (!expiresOn || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) || Number.isNaN(Date.parse(expiresOn)))
      throw new DomainError('EXPIRY_REQUIRED', 'Enter the batch expiry date.');
    const id = randomUUID();
    await tx.stockBatch.create({
      data: { id, ...ownership(a), productId: p.id, expiresOn, label: expiresOn, onHand: quantity },
    });
    return [{ id, quantity }];
  }
  const business = await tx.business.findUniqueOrThrow({ where: { id: a.businessId } });
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: business.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
  const batches = await tx.stockBatch.findMany({
    where: {
      productId: p.id,
      onHand: { gt: 0 },
      ...(allowExpired ? {} : { expiresOn: { gte: today } }),
    },
    orderBy: [{ expiresOn: 'asc' }, { id: 'asc' }],
  });
  let remaining = quantityUnits(-quantity);
  const result: Lot[] = [];
  for (const b of batches) {
    const units = quantityUnits(Number(b.onHand));
    const use = units < remaining ? units : remaining;
    if (use === 0n) break;
    const q = Number(use) / 1000;
    await tx.stockBatch.update({ where: { id: b.id }, data: { onHand: { decrement: q } } });
    result.push({ id: b.id, quantity: q });
    remaining -= use;
  }
  if (remaining > 0n)
    throw new DomainError(
      'EXPIRY_STOCK_UNAVAILABLE',
      'Not enough unexpired batch stock. Receive or reconcile the batches first.',
      409,
    );
  return result;
}
export async function restoreLots(
  tx: Transaction,
  lots: Lot[],
  quantity: number,
  prior: number,
  total: number,
) {
  const before = quantityUnits(prior),
    after = before + quantityUnits(quantity);
  const all = quantityUnits(total);
  let prefix = 0n;
  for (const l of lots) {
    const size = quantityUnits(l.quantity);
    const start = prefix;
    prefix += size;
    // Restore the same FEFO sequence used by the original sale, including expired lots.
    const take = (x: bigint) => (x <= start ? 0n : x >= prefix ? size : x - start);
    const delta = take(after > all ? all : after) - take(before);
    if (delta > 0n)
      await tx.stockBatch.update({
        where: { id: l.id },
        data: { onHand: { increment: Number(delta) / 1000 } },
      });
  }
}
export function includedTax(total: string, vatBps: number) {
  return (BigInt(total) * BigInt(vatBps) + BigInt(10000 + vatBps) / 2n) / BigInt(10000 + vatBps);
}
