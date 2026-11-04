import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Scope } from '../../../packages/contracts/src/index.js';
import { idSchema, moneySchema } from '../../../packages/contracts/src/index.js';
import { DomainError, stayNights } from '../../../packages/domain/src/index.js';
import { hasEffectiveModule } from '../../../packages/domain/src/industries.js';
import { audit, ownership, scoped, write, type Transaction } from './database.js';
import { postJournal } from './accounting.js';
import {
  createInvoiceInTransaction,
  issueInvoiceInTransaction,
  settleInTransaction,
} from './core.js';
import { postSale } from './sales.js';
import { orderLineSchema } from './restaurant.js';
const cashAccount = z.enum(['1000 Cash', '1010 Bank']);
const positiveMoney = moneySchema.refine((v) => BigInt(v) > 0n, 'Enter a positive amount.');
export const guestPaymentSchema = z
  .object({
    amount: positiveMoney,
    account: cashAccount,
    reference: z.string().trim().min(1).max(200),
  })
  .strict();
export const bookingSchema = z
  .object({
    roomId: idSchema,
    customerId: idSchema.optional(),
    guest: z
      .object({
        name: z.string().trim().min(2).max(160),
        phone: z.string().trim().max(80).default(''),
      })
      .strict()
      .optional(),
    checkIn: z.string().date(),
    checkOut: z.string().date(),
    guestCount: z.number().int().min(1).max(100).default(1),
    deposit: guestPaymentSchema.optional(),
  })
  .strict()
  .refine((v) => !!v.customerId !== !!v.guest, 'Choose an existing guest or enter a guest name.');
export const extraSchema = z
  .object({ name: z.string().trim().min(2).max(100), amount: positiveMoney })
  .strict();
export const checkoutSchema = z
  .object({
    extras: z.array(extraSchema).max(30).default([]),
    payment: guestPaymentSchema.optional(),
  })
  .strict();
const missing = () => new DomainError('NOT_FOUND', 'Stay or room not found in this branch.', 404);
const conflict = (message: string) => new DomainError('HOTEL_CONFLICT', message, 409);
async function enabled(tx: Transaction, a: Scope) {
  const b = await tx.business.findUniqueOrThrow({ where: { id: a.businessId } });
  if (!b.industryId || !hasEffectiveModule(b.industryId, 'accommodation'))
    throw new DomainError('MODULE_UNAVAILABLE', 'Accommodation is unavailable.', 404);
  return b;
}
async function lock(tx: Transaction, kind: string, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${kind + ':' + id},0))`;
}
async function stayLock(tx: Transaction, id: string) {
  const row = await tx.stay.findFirst({ where: { id } });
  if (!row) throw missing();
  await lock(tx, 'room', row.roomId);
  return tx.stay.findFirstOrThrow({ where: { id } });
}
function held(rows: { kind: string; amount: { toString(): string } }[]) {
  return rows.reduce(
    (n, d) => n + (d.kind === 'received' ? 1n : -1n) * BigInt(d.amount.toString()),
    0n,
  );
}
async function depositInTransaction(
  tx: Transaction,
  a: Scope,
  id: string,
  input: z.infer<typeof guestPaymentSchema>,
) {
  const stay = await tx.stay.findFirstOrThrow({ where: { id } });
  if (!['reserved', 'in_use'].includes(stay.status))
    throw conflict('Deposits are only accepted for open stays.');
  const deposits = await tx.guestDeposit.findMany({ where: { stayId: id } });
  if (held(deposits) + BigInt(input.amount) > BigInt(stay.total.toString()))
    throw conflict('Deposit exceeds the agreed room charge.');
  const depositId = randomUUID();
  await tx.guestDeposit.create({
    data: {
      id: depositId,
      ...ownership(a),
      stayId: id,
      ...input,
      kind: 'received',
      actorId: a.userId,
    },
  });
  await postJournal(tx, a, 'guest_deposit', depositId, [
    { account: input.account, debit: input.amount, credit: '0' },
    { account: '2300 Guest deposits', debit: '0', credit: input.amount },
  ]);
  await audit(tx, a, 'stay.deposit_received', id, input.reference);
  return { id: depositId };
}
export const bookStay = (s: Scope, key: string, input: z.infer<typeof bookingSchema>) =>
  write(s, 'hotel.book', 'stay.book', key, input, async (tx, a) => {
    await enabled(tx, a);
    await lock(tx, 'room', input.roomId);
    const room = await tx.room.findFirst({ where: { id: input.roomId } });
    if (!room) throw missing();
    if (room.status === 'under_repair') throw conflict('Finish repairs before booking this room.');
    const nights = stayNights(input.checkIn, input.checkOut);
    if (
      await tx.stay.findFirst({
        where: {
          roomId: room.id,
          status: { in: ['reserved', 'in_use'] },
          checkIn: { lt: input.checkOut },
          checkOut: { gt: input.checkIn },
        },
      })
    )
      throw new DomainError(
        'ROOM_UNAVAILABLE',
        'This room is reserved for part of those dates.',
        409,
      );
    let customerId = input.customerId;
    if (
      customerId &&
      !(await tx.customer.findFirst({ where: { id: customerId, archived: false } }))
    )
      throw missing();
    if (input.guest) {
      customerId = randomUUID();
      await tx.customer.create({
        data: {
          id: customerId,
          tenantId: a.tenantId,
          businessId: a.businessId,
          name: input.guest.name,
          phone: input.guest.phone || '',
          email: '',
        },
      });
    }
    const id = randomUUID(),
      total = (BigInt(room.rate.toString()) * BigInt(nights)).toString();
    if (BigInt(total) <= 0n || BigInt(total) > 999999999999999n)
      throw conflict('Room charge is outside the supported range.');
    await tx.stay.create({
      data: {
        id,
        ...ownership(a),
        roomId: room.id,
        customerId: customerId!,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        guestCount: input.guestCount,
        nights,
        rate: room.rate,
        total,
        actorId: a.userId,
      },
    });
    if (input.deposit) await depositInTransaction(tx, a, id, input.deposit);
    await audit(tx, a, 'stay.booked', id);
    return { id, nights, total };
  });
export const takeDeposit = (
  s: Scope,
  key: string,
  id: string,
  input: z.infer<typeof guestPaymentSchema>,
) =>
  write(s, 'hotel.book', 'stay.deposit', key, { id, ...input }, async (tx, a) => {
    await enabled(tx, a);
    await stayLock(tx, id);
    return depositInTransaction(tx, a, id, input);
  });
export const stayAction = (
  s: Scope,
  key: string,
  id: string,
  action: 'check_in' | 'cancelled' | 'no_show',
) =>
  write(s, 'hotel.book', 'stay.' + action, key, { id }, async (tx, a) => {
    const business = await enabled(tx, a);
    const stay = await stayLock(tx, id);
    if (stay.status !== 'reserved')
      throw conflict('Only a reservation can be checked in, cancelled or marked no-show.');
    if (action === 'check_in') {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: business.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      if (stay.checkIn > today || stay.checkOut <= today)
        throw conflict(
          'Check-in is available during the reserved dates. Review past or future stays first.',
        );
      const room = await tx.room.findFirstOrThrow({ where: { id: stay.roomId } });
      if (
        room.status !== 'available' ||
        (await tx.stay.findFirst({ where: { roomId: stay.roomId, status: 'in_use' } }))
      )
        throw conflict('The room must be available and clean before check-in.');
      await tx.stay.update({ where: { id }, data: { status: 'in_use', checkedInAt: new Date() } });
    } else {
      const rows = await tx.guestDeposit.findMany({ where: { stayId: id } });
      const outstanding = held(rows);
      // Cancellation/no-show refunds all held funds to their original cash/bank accounts.
      if (outstanding > 0n)
        for (const account of ['1000 Cash', '1010 Bank']) {
          const value = held(rows.filter((d) => d.account === account));
          if (value <= 0n) continue;
          const refundId = randomUUID();
          await tx.guestDeposit.create({
            data: {
              id: refundId,
              ...ownership(a),
              stayId: id,
              amount: value.toString(),
              kind: 'refunded',
              account,
              reference: action,
              actorId: a.userId,
            },
          });
          await postJournal(tx, a, 'guest_deposit_refund', refundId, [
            { account: '2300 Guest deposits', debit: value.toString(), credit: '0' },
            { account, debit: '0', credit: value.toString() },
          ]);
        }
      await tx.stay.update({ where: { id }, data: { status: action } });
    }
    await audit(tx, a, 'stay.' + action, id);
    return { id };
  });
async function service(tx: Transaction, a: Scope, kind: 'nights' | 'extras' | 'restaurant_charge') {
  await lock(tx, 'hotel-service', a.businessId + ':' + kind);
  let p = await tx.product.findFirst({ where: { systemKind: kind } });
  if (!p)
    p = await tx.product.create({
      data: {
        id: randomUUID(),
        tenantId: a.tenantId,
        businessId: a.businessId,
        name:
          kind === 'nights'
            ? 'Room nights'
            : kind === 'extras'
              ? 'Guest extras'
              : 'Restaurant room charges',
        sku: '__hotel_' + kind,
        category: 'Accommodation',
        type: 'service',
        price: '0',
        lowStock: 0,
        systemKind: kind,
      },
    });
  return p;
}
export const checkoutStay = (
  s: Scope,
  key: string,
  id: string,
  input: z.infer<typeof checkoutSchema>,
) =>
  write(s, 'hotel.checkout', 'stay.checkout', key, { id, ...input }, async (tx, a) => {
    const business = await enabled(tx, a),
      stay = await stayLock(tx, id);
    if (stay.status === 'checked_out' && stay.invoiceId) return { id: stay.invoiceId };
    if (stay.status !== 'in_use') throw conflict('Check in the guest before checkout.');
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: business.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const roomProduct = await service(tx, a, 'nights');
    const lines = [
      { productId: roomProduct.id, quantity: stay.nights, unitPrice: stay.rate.toString() },
    ];
    const extras = input.extras.reduce((n, e) => n + BigInt(e.amount), 0n);
    if (extras > 0n)
      lines.push({
        productId: (await service(tx, a, 'extras')).id,
        quantity: 1,
        unitPrice: extras.toString(),
      });
    const orders = await tx.restaurantOrder.findMany({ where: { stayId: id, status: 'paid' } });
    const charges = orders.reduce((n, o) => n + BigInt(o.total.toString()), 0n);
    if (charges > 0n)
      lines.push({
        productId: (await service(tx, a, 'restaurant_charge')).id,
        quantity: 1,
        unitPrice: charges.toString(),
      });
    const result = await createInvoiceInTransaction(
      tx,
      a,
      { customerId: stay.customerId, invoiceDate: date, dueDate: date, notes: 'Stay ' + id, lines },
      true,
    );
    await issueInvoiceInTransaction(tx, a, result.id);
    const deposits = held(await tx.guestDeposit.findMany({ where: { stayId: id } }));
    if (deposits > 0n) {
      const p = await settleInTransaction(
        tx,
        a,
        {
          amount: deposits.toString(),
          account: '2300 Guest deposits',
          reference: 'Deposit applied to stay ' + id,
        },
        result.id,
        'invoice',
      );
      await tx.guestDeposit.create({
        data: {
          id: randomUUID(),
          ...ownership(a),
          stayId: id,
          amount: deposits.toString(),
          kind: 'applied',
          account: '2300 Guest deposits',
          reference: 'Checkout',
          paymentId: p.id,
          actorId: a.userId,
        },
      });
    }
    if (input.payment) await settleInTransaction(tx, a, input.payment, result.id, 'invoice');
    await tx.stay.update({
      where: { id },
      data: {
        status: 'checked_out',
        invoiceId: result.id,
        extras: input.extras,
        checkedOutAt: new Date(),
        legacyUnbilled: false,
      },
    });
    await tx.room.update({ where: { id: stay.roomId }, data: { status: 'needs_cleaning' } });
    await audit(tx, a, 'stay.checked_out', id);
    return result;
  });
export const payStay = (
  s: Scope,
  key: string,
  id: string,
  input: z.infer<typeof guestPaymentSchema>,
) =>
  write(s, 'hotel.checkout', 'stay.payment', key, { id, ...input }, async (tx, a) => {
    await enabled(tx, a);
    const stay = await stayLock(tx, id);
    if (!stay.invoiceId)
      throw conflict('Checkout must issue the bill before collecting its balance.');
    return settleInTransaction(tx, a, input, stay.invoiceId, 'invoice');
  });
export const housekeeping = (s: Scope) =>
  scoped(s, 'hotel.clean', async (tx, a) => {
    await enabled(tx, a);
    const rooms = await tx.room.findMany({ orderBy: { name: 'asc' } });
    const active = await tx.stay.findMany({ where: { status: 'in_use' } });
    return {
      rooms: rooms.map((r) => ({
        id: r.id,
        name: r.name,
        status: active.some((s) => s.roomId === r.id) ? 'in_use' : r.status,
      })),
    };
  });
export const cleanRoom = (s: Scope, key: string, id: string, status: 'cleaning' | 'available') =>
  write(s, 'hotel.clean', 'room.clean', key, { id, status }, async (tx, a) => {
    await enabled(tx, a);
    await lock(tx, 'room', id);
    const r = await tx.room.findFirst({ where: { id } });
    if (!r) throw missing();
    if (await tx.stay.findFirst({ where: { roomId: id, status: 'in_use' } }))
      throw conflict('An occupied room cannot be marked clean.');
    if (!(
      (r.status === 'needs_cleaning' && status === 'cleaning') ||
      (r.status === 'cleaning' && status === 'available')
    ))
      throw conflict('Start cleaning, then mark the room done.');
    await tx.room.update({ where: { id }, data: { status } });
    await audit(tx, a, 'room.' + status, id);
    return { id };
  });
export const repairRoom = (s: Scope, key: string, id: string, repair: boolean) =>
  write(s, 'business.manage', 'room.repair', key, { id, repair }, async (tx, a) => {
    await enabled(tx, a);
    await lock(tx, 'room', id);
    if (await tx.stay.findFirst({ where: { roomId: id, status: 'in_use' } }))
      throw conflict('Check out the guest before taking the room out of service.');
    if (!(await tx.room.findFirst({ where: { id } }))) throw missing();
    await tx.room.update({
      where: { id },
      data: { status: repair ? 'under_repair' : 'needs_cleaning' },
    });
    await audit(tx, a, 'room.repair_changed', id);
    return { id };
  });
export const hotelBoard = (s: Scope) =>
  scoped(s, 'hotel.read', async (tx, a) => {
    const business = await enabled(tx, a);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: business.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const rooms = await tx.room.findMany({ orderBy: { name: 'asc' } }),
      stays = await tx.stay.findMany({ orderBy: { createdAt: 'desc' } }),
      customers = await tx.customer.findMany({ where: { archived: false } }),
      deposits = await tx.guestDeposit.findMany(),
      invoices = await tx.invoice.findMany({
        where: { id: { in: stays.flatMap((s) => (s.invoiceId ? [s.invoiceId] : [])) } },
      });
    return {
      rooms: rooms.map((r) => ({
        ...r,
        rate: r.rate.toString(),
        occupied: stays.some((s) => s.roomId === r.id && s.status === 'in_use'),
        status:
          r.status !== 'available'
            ? r.status
            : stays.some((s) => s.roomId === r.id && s.status === 'in_use')
              ? 'in_use'
              : stays.some(
                    (s) => s.roomId === r.id && s.status === 'reserved' && s.checkOut > today,
                  )
                ? 'reserved'
                : 'available',
      })),
      stays: stays.map((s) => {
        const invoice = invoices.find((i) => i.id === s.invoiceId);
        return {
          ...s,
          rate: s.rate.toString(),
          total: s.total.toString(),
          guest: customers.find((c) => c.id === s.customerId)?.name,
          deposit: held(deposits.filter((d) => d.stayId === s.id)).toString(),
          billTotal: invoice?.total.toString(),
          paid: invoice?.paid.toString(),
          balance: invoice
            ? (BigInt(invoice.total.toString()) - BigInt(invoice.paid.toString())).toString()
            : null,
        };
      }),
      customers,
    };
  });
export const roomCharge = (s: Scope, key: string, id: string, stayId: string) =>
  write(s, 'restaurant.pay', 'order.room_charge', key, { id, stayId }, async (tx, a) => {
    await enabled(tx, a);
    const stay = await stayLock(tx, stayId);
    if (stay.status !== 'in_use') throw conflict('Select a checked-in guest.');
    await lock(tx, 'order', id);
    const o = await tx.restaurantOrder.findFirst({ where: { id } });
    if (!o) throw missing();
    if (o.status === 'paid') {
      if (o.stayId !== stayId) throw conflict('This order was already settled elsewhere.');
      return { id: o.saleId! };
    }
    if (!['ready', 'served'].includes(o.status))
      throw conflict('The order must be ready or served.');
    const lines = z
      .array(
        orderLineSchema.extend({ name: z.string(), unitPrice: moneySchema, total: moneySchema }),
      )
      .parse(o.lines);
    for (const l of lines) {
      const p = await tx.product.findFirst({ where: { id: l.productId, archived: false } });
      if (!p || p.price.toString() !== l.unitPrice)
        throw conflict('Review this order after a menu price change.');
    }
    const result = await postSale(
      tx,
      a,
      key,
      {
        lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        cashSessionId: randomUUID(),
        tendered: o.total.toString(),
        customerId: stay.customerId,
        payment: { method: 'cash' },
      },
      undefined,
      { roomCharge: true, restaurant: true },
    );
    await tx.restaurantOrder.update({
      where: { id },
      data: { status: 'paid', saleId: result.id, stayId },
    });
    await audit(tx, a, 'order.charged_to_room', id);
    return result;
  });

export const chargeGuests = (s: Scope) =>
  scoped(s, 'restaurant.pay', async (tx, a) => {
    await enabled(tx, a);
    const stays = await tx.stay.findMany({ where: { status: 'in_use' } }),
      customers = await tx.customer.findMany({
        where: { id: { in: stays.map((s) => s.customerId) } },
      }),
      rooms = await tx.room.findMany();
    return {
      stays: stays.map((s) => ({
        id: s.id,
        roomId: s.roomId,
        status: s.status,
        guest: customers.find((c) => c.id === s.customerId)?.name,
      })),
      rooms: rooms.map((r) => ({ id: r.id, name: r.name })),
    };
  });
export const stayBill = (s: Scope, id: string) =>
  scoped(s, 'hotel.read', async (tx, a) => {
    await enabled(tx, a);
    const stay = await tx.stay.findFirst({ where: { id } });
    if (!stay) throw missing();
    const invoice = stay.invoiceId
      ? await tx.invoice.findFirst({ where: { id: stay.invoiceId } })
      : null;
    const lines = invoice
      ? await tx.invoiceLine.findMany({ where: { invoiceId: invoice.id } })
      : [];
    const deposits = await tx.guestDeposit.findMany({
      where: { stayId: id },
      orderBy: { createdAt: 'asc' },
    });
    const payments = invoice
      ? await tx.financePayment.findMany({
          where: { invoiceId: invoice.id },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const orders = await tx.restaurantOrder.findMany({ where: { stayId: id } });
    return {
      stayId: id,
      estimatedTotal: (
        BigInt(stay.total.toString()) + orders.reduce((n, o) => n + BigInt(o.total.toString()), 0n)
      ).toString(),
      deposit: held(deposits).toString(),
      extras: stay.extras,
      invoice: invoice
        ? {
            id: invoice.id,
            number: invoice.number,
            total: invoice.total.toString(),
            paid: invoice.paid.toString(),
            balance: (
              BigInt(invoice.total.toString()) - BigInt(invoice.paid.toString())
            ).toString(),
          }
        : null,
      lines: lines.map((l) => ({
        name: l.name,
        quantity: Number(l.quantity),
        unitPrice: l.unitPrice.toString(),
        total: l.total.toString(),
        tax: l.tax.toString(),
      })),
      deposits: deposits.map((d) => ({
        kind: d.kind,
        amount: d.amount.toString(),
        account: d.account,
        reference: d.reference,
        createdAt: d.createdAt.toISOString(),
      })),
      payments: payments.map((p) => ({
        amount: p.amount.toString(),
        account: p.account,
        reference: p.reference,
        createdAt: p.createdAt.toISOString(),
      })),
      restaurantCharges: orders.map((o) => ({
        id: o.id,
        saleId: o.saleId,
        lines: z
          .array(
            orderLineSchema.extend({
              name: z.string(),
              unitPrice: moneySchema,
              total: moneySchema,
            }),
          )
          .parse(o.lines)
          .map((l) => ({ name: l.name, quantity: l.quantity, total: l.total })),
        total: o.total.toString(),
      })),
    };
  });
