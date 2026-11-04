import { randomUUID } from 'node:crypto';
import type { CashSession, Scope } from '../../../packages/contracts/src/index.js';
import { DomainError, amount } from '../../../packages/domain/src/index.js';
import { scoped, write, audit, ownership, type Transaction } from './database.js';

export async function lockCash(tx: Transaction, s: Scope, id: string): Promise<void> {
  const rows = await tx.$queryRaw<
    { id: string; user_id: string }[]
  >`SELECT id,user_id FROM cash_sessions WHERE id=${id}::uuid AND status='open' FOR UPDATE`;
  if (!rows[0] || rows[0].user_id !== s.userId)
    throw new DomainError(
      'CASH_SESSION_CLOSED',
      'Open your own register session in this branch first.',
      409,
    );
}
export async function getCash(tx: Transaction, s: Scope, id?: string): Promise<CashSession | null> {
  const c = await tx.cashSession.findFirst({
    where: {
      ...ownership(s),
      userId: s.userId,
      ...(id ? { id } : { status: 'open' }),
    },
    orderBy: { openedAt: 'desc' },
  });
  if (!c) return null;
  const payments = await tx.payment.findMany({
    where: { cashSessionId: c.id, method: 'cash', status: 'confirmed' },
  });
  const expected = payments.reduce(
    (n, p) => n + (p.direction === 'in' ? 1n : -1n) * BigInt(p.amount.toString()),
    BigInt(c.openingFloat.toString()),
  );
  return {
    id: c.id,
    openingFloat: c.openingFloat.toString(),
    expected: expected.toString(),
    status: c.status,
    openedAt: c.openedAt.toISOString(),
    counted: c.counted?.toString() ?? null,
    variance: c.variance?.toString() ?? null,
  };
}
export const cashSession = (s: Scope) => scoped(s, 'cash.manage', (tx, a) => getCash(tx, a));
export async function openCash(
  s: Scope,
  key: string,
  openingFloat: string,
): Promise<{ id: string }> {
  return write(s, 'cash.manage', 'cash.open', key, { openingFloat }, async (tx, a) => {
    const id = randomUUID();
    await tx.cashSession.create({
      data: { id, ...ownership(a), userId: a.userId, openingFloat },
    });
    await audit(tx, a, 'cash.opened', id);
    return { id };
  });
}
export async function closeCash(
  s: Scope,
  key: string,
  id: string,
  counted: string,
  reason: string,
): Promise<{ id: string; expected: string; variance: string }> {
  return write(s, 'cash.manage', 'cash.close', key, { id, counted, reason }, async (tx, a) => {
    await lockCash(tx, a, id);
    const session = await getCash(tx, a, id);
    if (!session) throw new DomainError('NOT_FOUND', 'Register not found.', 404);
    const variance = (amount(counted) - BigInt(session.expected)).toString();
    if (variance !== '0' && reason.trim().length < 3)
      throw new DomainError(
        'REASON_REQUIRED',
        'Explain the difference between expected and counted cash.',
      );
    await tx.cashSession.update({
      where: { id },
      data: {
        status: 'closed',
        counted,
        variance,
        reason,
        closedAt: new Date(),
      },
    });
    await audit(tx, a, 'cash.closed', id, reason);
    return { id, expected: session.expected, variance };
  });
}
