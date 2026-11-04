import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Scope } from '../../../packages/contracts/src/index.js';
import {
  idSchema,
  quantitySchema,
  paymentEvidenceSchema,
  moneySchema,
} from '../../../packages/contracts/src/index.js';
import { DomainError, lineAmount, can } from '../../../packages/domain/src/index.js';
import { hasEffectiveModule } from '../../../packages/domain/src/industries.js';
import { audit, scoped, write, ownership, type Transaction } from './database.js';
import { postSale } from './sales.js';
export const orderLineSchema = z
  .object({
    productId: idSchema,
    quantity: quantitySchema,
    kind: z.enum(['food', 'drink']),
    notes: z.string().trim().max(300).optional(),
  })
  .strict();
export const orderSchema = z
  .object({ tableId: idSchema.optional(), lines: z.array(orderLineSchema).min(1).max(100) })
  .strict()
  .refine(
    (v) => new Set(v.lines.map((l) => l.productId)).size === v.lines.length,
    'Combine duplicate products.',
  );
export const orderPaymentSchema = z
  .object({ cashSessionId: idSchema, tendered: moneySchema, payment: paymentEvidenceSchema })
  .strict();
async function restaurant(tx: Transaction, a: Scope) {
  const b = await tx.business.findUniqueOrThrow({ where: { id: a.businessId } });
  if (!b.industryId || !hasEffectiveModule(b.industryId, 'restaurant'))
    throw new DomainError(
      'MODULE_UNAVAILABLE',
      'Restaurant operations are unavailable for this business.',
      404,
    );
  return b;
}
export const addTable = (s: Scope, key: string, name: string) =>
  write(s, 'business.manage', 'table.create', key, { name }, async (tx, a) => {
    await restaurant(tx, a);
    const id = randomUUID();
    await tx.diningTable.create({ data: { id, ...ownership(a), name } });
    await audit(tx, a, 'table.created', id);
    return { id };
  });
export const createOrder = (s: Scope, key: string, input: z.infer<typeof orderSchema>) =>
  write(s, 'restaurant.order', 'order.create', key, input, async (tx, a) => {
    await restaurant(tx, a);
    if (input.tableId && !(await tx.diningTable.findFirst({ where: { id: input.tableId } })))
      throw new DomainError('NOT_FOUND', 'Choose a table in this branch.', 404);
    if (input.tableId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'table:' + input.tableId},0))`;
      if (
        await tx.restaurantOrder.findFirst({
          where: { tableId: input.tableId, status: { notIn: ['paid', 'cancelled'] } },
        })
      )
        throw new DomainError(
          'TABLE_ORDER_OPEN',
          'Append items to the existing open table order.',
          409,
        );
    }
    let total = 0n;
    const lines = [];
    for (const l of input.lines) {
      const p = await tx.product.findFirst({ where: { id: l.productId, archived: false } });
      if (!p || p.isGroup || p.systemKind)
        throw new DomainError('PRODUCT_UNAVAILABLE', 'Choose an active menu item.', 409);
      const value = lineAmount(p.price.toString(), l.quantity);
      total += value;
      lines.push({ ...l, name: p.name, unitPrice: p.price.toString(), total: value.toString() });
    }
    if (total <= 0n) throw new DomainError('INVALID_AMOUNT', 'The order total must be positive.');
    const id = randomUUID();
    await tx.restaurantOrder.create({
      data: {
        id,
        ...ownership(a),
        tableId: input.tableId,
        lines,
        total: total.toString(),
        actorId: a.userId,
      },
    });
    await audit(tx, a, 'order.created', id);
    return { id };
  });
export const payOrder = (
  s: Scope,
  key: string,
  id: string,
  input: z.infer<typeof orderPaymentSchema>,
) =>
  write(s, 'restaurant.pay', 'order.pay', key, { id, ...input }, async (tx, a) => {
    await restaurant(tx, a);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'order:' + id},0))`;
    const order = await tx.restaurantOrder.findFirst({ where: { id } });
    if (!order) throw new DomainError('NOT_FOUND', 'Order not found.', 404);
    if (order.status === 'paid') return { id: order.saleId! };
    if (!['ready', 'served'].includes(order.status))
      throw new DomainError(
        'ORDER_NOT_READY',
        'Mark the order ready or served before payment.',
        409,
      );
    const lines = z
      .array(
        orderLineSchema.extend({ name: z.string(), unitPrice: moneySchema, total: moneySchema }),
      )
      .parse(order.lines);
    // Keep the online stock guard and the reviewed current prices. A changed price needs a new order.
    for (const l of lines) {
      const p = await tx.product.findFirst({ where: { id: l.productId } });
      if (!p || p.price.toString() !== l.unitPrice)
        throw new DomainError(
          'PRICE_CHANGED',
          'A menu price changed. Review the order before collecting payment.',
          409,
        );
    }
    const result = await postSale(
      tx,
      a,
      key,
      {
        ...input,
        lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      },
      undefined,
      { restaurant: true },
    );
    await tx.restaurantOrder.update({ where: { id }, data: { status: 'paid', saleId: result.id } });
    await audit(tx, a, 'order.paid', id);
    return result;
  });
export const restaurantDashboard = (s: Scope) =>
  scoped(s, 'restaurant.read', async (tx, a) => {
    const business = await restaurant(tx, a),
      today = new Intl.DateTimeFormat('en-CA', {
        timeZone: business.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    const orders = await tx.restaurantOrder.findMany({ orderBy: { createdAt: 'desc' } }),
      tables = await tx.diningTable.findMany({ orderBy: { name: 'asc' } });
    const day = orders.filter(
      (o) =>
        new Intl.DateTimeFormat('en-CA', {
          timeZone: business.timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(o.createdAt) === today,
    );
    const lines = day.map((o) =>
      z
        .array(
          orderLineSchema.extend({ name: z.string(), unitPrice: moneySchema, total: moneySchema }),
        )
        .parse(o.lines),
    );
    const saleIds = orders.filter((o) => o.saleId).map((o) => o.saleId!);
    const sales = await tx.sale.findMany({ where: { id: { in: saleIds } } });
    const businessDate = (time: Date) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: business.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(time);
    const paidToday = sales.filter((s) => businessDate(s.createdAt) === today);
    const refunds = (await tx.return.findMany({ where: { saleId: { in: saleIds } } })).filter(
      (r) => businessDate(r.createdAt) === today,
    );
    const active = tables.filter((t) =>
      orders.some((o) => o.tableId === t.id && !['paid', 'cancelled'].includes(o.status)),
    ).length;
    const soldLines = await tx.saleLine.findMany({
      where: { saleId: { in: paidToday.map((s) => s.id) } },
    });
    const top = new Map<string, { name: string; quantity: number }>();
    for (const l of soldLines) {
      const v = top.get(l.productId) ?? { name: l.name, quantity: 0 };
      v.quantity += Number(l.quantity);
      top.set(l.productId, v);
    }
    return {
      waiting: orders.filter((o) => o.status === 'new').length,
      preparing: orders.filter((o) => o.status === 'preparing').length,
      ready: orders.filter((o) => ['ready', 'served'].includes(o.status)).length,
      topMenu: [...top.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5),
      today,
      foodOrders: lines.filter((l) => l.some((l) => l.kind === 'food')).length,
      drinkOrders: lines.filter((l) => l.some((l) => l.kind === 'drink')).length,
      paid: paidToday.length,
      unpaid: day.filter((o) => !['paid', 'cancelled'].includes(o.status)).length,
      availableTables: tables.length - active,
      activeTables: active,
      ...(can(a.role, 'finance.read')
        ? {
            earnings: (
              paidToday.reduce((n, o) => n + BigInt(o.total.toString()), 0n) -
              refunds.reduce((n, r) => n + BigInt(r.total.toString()), 0n)
            ).toString(),
          }
        : {}),
      tables: tables.map((t) => ({
        ...t,
        active: orders.some((o) => o.tableId === t.id && !['paid', 'cancelled'].includes(o.status)),
      })),
      orders: orders
        .filter(
          (o) =>
            !['paid', 'cancelled'].includes(o.status) ||
            day.some((d) => d.id === o.id) ||
            paidToday.some((s) => s.id === o.saleId),
        )
        .map((o) => ({ ...o, total: o.total.toString() })),
    };
  });

export const kitchenQueue = (s: Scope) =>
  scoped(s, 'restaurant.prepare', async (tx, a) => {
    await restaurant(tx, a);
    const orders = await tx.restaurantOrder.findMany({
      where: { status: { in: ['new', 'preparing'] } },
      orderBy: { createdAt: 'asc' },
    });
    const tables = await tx.diningTable.findMany();
    // Explicit whitelist: never serialize the order JSON or Product (contains prices/costs).
    return {
      orders: orders.map((o) => ({
        id: o.id,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
        table: tables.find((t) => t.id === o.tableId)?.name ?? null,
        lines: z
          .array(
            orderLineSchema.extend({
              name: z.string(),
              unitPrice: moneySchema,
              total: moneySchema,
            }),
          )
          .parse(o.lines)
          .map((l) => ({ name: l.name, quantity: l.quantity, kind: l.kind, notes: l.notes ?? '' })),
      })),
    };
  });
export const transitionOrder = (
  s: Scope,
  key: string,
  id: string,
  status: 'preparing' | 'ready' | 'served' | 'cancelled',
) =>
  write(
    s,
    status === 'preparing' || status === 'ready' ? 'restaurant.prepare' : 'restaurant.order',
    'order.transition',
    key,
    { id, status },
    async (tx, a) => {
      await restaurant(tx, a);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'order:' + id},0))`;
      const o = await tx.restaurantOrder.findFirst({ where: { id } });
      if (!o) throw new DomainError('NOT_FOUND', 'Order not found.', 404);
      const allowed: Record<string, string[]> = {
        new: ['preparing', ...(o.tableId ? [] : ['ready']), 'cancelled'],
        preparing: ['ready', 'cancelled'],
        ready: ['served', 'cancelled'],
        served: ['cancelled'],
      };
      if (!allowed[o.status]?.includes(status))
        throw new DomainError('INVALID_TRANSITION', 'This order changed. Refresh its status.', 409);
      await tx.restaurantOrder.update({ where: { id }, data: { status } });
      await audit(tx, a, 'order.' + status, id);
      return { id };
    },
  );
export const appendOrder = (
  s: Scope,
  key: string,
  id: string,
  input: z.infer<typeof orderSchema>,
) =>
  write(s, 'restaurant.order', 'order.append', key, { id, ...input }, async (tx, a) => {
    await restaurant(tx, a);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'order:' + id},0))`;
    const o = await tx.restaurantOrder.findFirst({ where: { id } });
    if (!o) throw new DomainError('NOT_FOUND', 'Order not found.', 404);
    if (['paid', 'cancelled'].includes(o.status))
      throw new DomainError('ORDER_CLOSED', 'This order is closed.', 409);
    const lines = z
      .array(
        orderLineSchema.extend({ name: z.string(), unitPrice: moneySchema, total: moneySchema }),
      )
      .parse(o.lines);
    for (const l of input.lines) {
      const p = await tx.product.findFirst({
        where: { id: l.productId, archived: false, isGroup: false, systemKind: null },
      });
      if (!p) throw new DomainError('NOT_FOUND', 'Menu item unavailable.', 404);
      const existing = lines.find((x) => x.productId === p.id);
      if (existing) {
        if (existing.unitPrice !== p.price.toString())
          throw new DomainError('PRICE_CHANGED', 'Review this order after a price change.', 409);
        if (l.notes) existing.notes = l.notes;
        existing.quantity = Number((existing.quantity + l.quantity).toFixed(3));
        existing.total = lineAmount(existing.unitPrice, existing.quantity).toString();
      } else
        lines.push({
          ...l,
          name: p.name,
          unitPrice: p.price.toString(),
          total: lineAmount(p.price.toString(), l.quantity).toString(),
        });
    }
    if (lines.length > 100)
      throw new DomainError('ORDER_TOO_LARGE', 'An order supports at most 100 menu items.');
    await tx.restaurantOrder.update({
      where: { id },
      data: {
        lines,
        total: lines.reduce((n, l) => n + BigInt(l.total), 0n).toString(),
        status: 'new',
      },
    });
    await audit(tx, a, 'order.items_added', id);
    return { id };
  });
