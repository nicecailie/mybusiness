import { randomUUID } from 'node:crypto';
import type {
  Scope,
  ProductInput,
  ReceiveInput,
  Product,
  CustomerInput,
} from '../../../packages/contracts/src/index.js';
import {
  DomainError,
  can,
  lineAmount,
  allocatedCost,
  quantityUnits,
} from '../../../packages/domain/src/index.js';
import { scoped, write, audit, ownership, type Transaction } from './database.js';
import { postJournal } from './accounting.js';

export async function listProducts(
  tx: Transaction,
  s: Scope,
  search = '',
  page = 1,
  limit = 30,
  archived = false,
): Promise<{ items: Product[]; total: number }> {
  const where = {
    tenantId: s.tenantId,
    businessId: s.businessId,
    archived,
    OR: [
      { name: { contains: search, mode: 'insensitive' as const } },
      { sku: { contains: search, mode: 'insensitive' as const } },
      { barcode: { equals: search } },
    ],
  };
  const products = await tx.product.findMany({
    where,
    orderBy: { name: 'asc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await tx.product.count({ where });
  const balances = await tx.stockBalance.findMany({
    where: { ...ownership(s), productId: { in: products.map((p) => p.id) } },
  });
  return {
    total,
    items: products.map((p) => {
      const b = balances.find((b) => b.productId === p.id);
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        category: p.category,
        type: p.type,
        price: p.price.toString(),
        ...(can(s.role, 'stock.receive')
          ? {
              cost:
                b && Number(b.onHand) > 0
                  ? (
                      (BigInt(b.value.toString()) * 1000n) /
                      quantityUnits(Number(b.onHand))
                    ).toString()
                  : '0',
            }
          : {}),
        onHand: Number(b?.onHand ?? 0),
        lowStock: Number(p.lowStock),
        archived: p.archived,
      };
    }),
  };
}
export async function createProduct(
  s: Scope,
  key: string,
  input: ProductInput,
): Promise<{ id: string }> {
  return write(s, 'catalog.write', 'product.create', key, input, async (tx, a) => {
    const { cost, initialQuantity, initialReason, ...fields } = input;
    const id = randomUUID();
    await tx.product.create({
      data: {
        id,
        tenantId: a.tenantId,
        businessId: a.businessId,
        ...fields,
        barcode: fields.barcode || null,
      },
    });
    if (initialQuantity) {
      if (!can(a.role, 'stock.receive'))
        throw new DomainError('FORBIDDEN', 'Your role cannot set initial stock.', 403);
      if (fields.type !== 'goods')
        throw new DomainError('INVALID_STOCK', 'Services do not have stock.');
      await adjustStock(
        tx,
        a,
        {
          productId: id,
          quantity: initialQuantity,
          unitCost: cost,
          reason: initialReason || 'Initial product quantity',
          direction: 'increase',
        },
        true,
      );
    }
    await audit(tx, a, 'product.created', id);
    return { id };
  });
}
export async function receiveStock(
  s: Scope,
  key: string,
  input: ReceiveInput,
): Promise<{ id: string }> {
  return write(s, 'stock.receive', 'stock.receive', key, input, (tx, a) =>
    adjustStock(tx, a, input),
  );
}
export async function adjustStock(
  tx: Transaction,
  a: Scope,
  input: ReceiveInput,
  initial = false,
): Promise<{ id: string }> {
  const p = await tx.product.findFirst({ where: { id: input.productId, archived: false } });
  if (!p || p.type !== 'goods')
    throw new DomainError('NOT_FOUND', 'Choose an active stock-tracked product.', 404);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'stock:' + a.branchId + ':' + p.id},0))`;
  const b = await tx.stockBalance.findFirst({ where: { productId: p.id } });
  const available = Number(b?.onHand ?? 0),
    decrease = input.direction === 'decrease';
  if (decrease && input.quantity > Math.max(0, available))
    throw new DomainError(
      'INSUFFICIENT_STOCK',
      'A decrease cannot consume unavailable stock.',
      409,
    );
  // No stock cost is divided by a negative quantity. Shortage costs remain provisional.
  // Until the business approves a shortage valuation, a delivery covering negative inventory
  // needs reconciliation first; ordinary positive-stock adjustments keep the existing journal model.
  if (!decrease && available < 0)
    throw new DomainError(
      'SHORTAGE_VALUATION_REQUIRED',
      'Resolve the shortage with a reviewed quantity correction before entering valued stock. Shortage cost policy remains pending.',
      409,
    );
  const cost = decrease
    ? allocatedCost(b!.value.toString(), input.quantity, available)
    : lineAmount(input.unitCost, input.quantity);
  if (!decrease && input.unitCost === '0')
    throw new DomainError('INVALID_COST', 'Stock increases require a positive reviewed cost.');
  const quantity = decrease ? -input.quantity : input.quantity,
    value = decrease ? -cost : cost,
    id = randomUUID();
  if (b)
    await tx.stockBalance.update({
      where: { id: b.id },
      data: { onHand: { increment: quantity }, value: { increment: value.toString() } },
    });
  else
    await tx.stockBalance.create({
      data: {
        id: randomUUID(),
        ...ownership(a),
        productId: p.id,
        onHand: quantity,
        value: value.toString(),
      },
    });
  await tx.stockMovement.create({
    data: {
      id,
      ...ownership(a),
      productId: p.id,
      quantity,
      value: value.toString(),
      sourceType: initial ? 'opening' : 'adjustment',
      sourceId: id,
      reason: input.reason,
      actorId: a.userId,
    },
  });
  if (cost > 0n)
    await postJournal(
      tx,
      a,
      initial ? 'opening' : 'adjustment',
      id,
      decrease
        ? [
            { account: '5100 Damaged goods', debit: cost.toString(), credit: '0' },
            { account: '1200 Inventory', debit: '0', credit: cost.toString() },
          ]
        : [
            { account: '1200 Inventory', debit: cost.toString(), credit: '0' },
            { account: '3000 Opening equity', debit: '0', credit: cost.toString() },
          ],
    );
  await audit(tx, a, 'stock.adjusted', id, input.reason);
  return { id };
}
export async function updateProduct(
  s: Scope,
  key: string,
  id: string,
  input: ProductInput,
): Promise<{ id: string }> {
  return write(s, 'catalog.write', 'product.update', key, { id, ...input }, async (tx, a) => {
    const { cost: _cost, initialQuantity: _quantity, initialReason: _reason, ...fields } = input;
    const original = await tx.product.findFirst({ where: { id } });
    if (!original) throw new DomainError('NOT_FOUND', 'Product not found.', 404);
    if (original.type !== fields.type)
      throw new DomainError(
        'INVALID_TYPE',
        'The stock tracking type cannot change after creation.',
      );
    await tx.product.update({
      where: { id },
      data: { ...fields, barcode: fields.barcode || null, version: { increment: 1 } },
    });
    // All operational references already use stable product IDs. Sale lines are receipt snapshots.
    await audit(
      tx,
      a,
      'product.updated',
      id,
      JSON.stringify({
        oldCode: original.sku,
        newCode: fields.sku,
        oldPrice: original.price.toString(),
        newPrice: fields.price,
      }),
    );
    return { id };
  });
}
export async function restoreProduct(s: Scope, key: string, id: string): Promise<{ id: string }> {
  return write(s, 'catalog.write', 'product.restore', key, { id }, async (tx, a) => {
    if (
      !(
        await tx.product.updateMany({
          where: { id, archived: true },
          data: { archived: false, version: { increment: 1 } },
        })
      ).count
    )
      throw new DomainError('NOT_FOUND', 'Archived product not found.', 404);
    await audit(tx, a, 'product.restored', id);
    return { id };
  });
}
export async function createCustomer(
  s: Scope,
  key: string,
  input: CustomerInput,
): Promise<{ id: string }> {
  return write(s, 'customer.write', 'customer.create', key, input, async (tx, a) => {
    if (
      input.phone &&
      (await tx.customer.findFirst({
        where: { phone: input.phone, archived: false },
      }))
    )
      throw new DomainError(
        'DUPLICATE_CUSTOMER',
        'A customer with that phone number already exists.',
        409,
      );
    const id = randomUUID();
    await tx.customer.create({
      data: { id, tenantId: a.tenantId, businessId: a.businessId, ...input },
    });
    await audit(tx, a, 'customer.created', id);
    return { id };
  });
}
export async function archiveProduct(s: Scope, key: string, id: string): Promise<{ id: string }> {
  return write(s, 'catalog.write', 'product.archive', key, { id }, async (tx, a) => {
    const result = await tx.product.updateMany({
      where: { id, archived: false },
      data: { archived: true, version: { increment: 1 } },
    });
    if (!result.count) throw new DomainError('NOT_FOUND', 'Product not found.', 404);
    await audit(tx, a, 'product.archived', id);
    return { id };
  });
}
export const products = (s: Scope, search: string, page: number, limit: number, archived = false) =>
  scoped(s, 'catalog.read', (tx, a) => listProducts(tx, a, search, page, limit, archived));
