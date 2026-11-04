import { config } from 'dotenv';
config({ path: new URL('../../../.env', import.meta.url), quiet: true });
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import type { Permission, Scope, Role, Context } from '../../../packages/contracts/src/index.js';
import { DomainError, requirePermission } from '../../../packages/domain/src/index.js';
import {
  hasEffectiveModule,
  type IndustryModule,
} from '../../../packages/domain/src/industries.js';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 15,
});
export const db = new PrismaClient({ adapter: new PrismaPg(pool) });
export type Transaction = Prisma.TransactionClient;
export const ownership = (
  s: Scope,
): { tenantId: string; businessId: string; branchId: string } => ({
  tenantId: s.tenantId,
  businessId: s.businessId,
  branchId: s.branchId,
});
export async function contexts(userId: string): Promise<Context[]> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    return tx.$queryRaw<
      Context[]
    >`SELECT m.user_id AS "userId", m.tenant_id AS "tenantId", m.business_id AS "businessId", b.name AS "businessName", m.branch_id AS "branchId", br.name AS "branchName", m.role, b.currency, b.timezone, b.locale, b.industry_id AS "industryId", t.demo FROM memberships m JOIN businesses b ON b.id=m.business_id JOIN branches br ON br.id=m.branch_id JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=${userId} AND m.active=true ORDER BY t.name,br.name`;
  });
}
export async function scoped<T>(
  scope: Scope,
  permission: Permission,
  fn: (tx: Transaction, authorized: Scope) => Promise<T>,
  isolationLevel?: Prisma.TransactionIsolationLevel,
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${scope.userId}, true)`;
      // Lock membership until commit: revocation serializes with an already-authorized write.
      const rows = await tx.$queryRaw<
        { role: Role }[]
      >`SELECT role FROM lock_membership(${scope.userId},${scope.tenantId}::uuid,${scope.businessId}::uuid,${scope.branchId}::uuid)`;
      const member = rows[0];
      if (!member)
        throw new DomainError(
          'FORBIDDEN',
          'This business or branch is unavailable to your account.',
          403,
        );
      requirePermission(member.role, permission);
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${scope.tenantId}, true), set_config('app.business_id', ${scope.businessId}, true), set_config('app.branch_id', ${scope.branchId}, true)`;
      const moduleByPermission: Partial<Record<Permission, IndustryModule>> = {
        'restaurant.read': 'restaurant',
        'restaurant.order': 'restaurant',
        'restaurant.prepare': 'restaurant',
        'restaurant.pay': 'restaurant',
        'hotel.read': 'accommodation',
        'hotel.book': 'accommodation',
        'hotel.checkout': 'accommodation',
        'hotel.clean': 'accommodation',
        'supplier.read': 'purchasing',
        'supplier.create': 'purchasing',
        'supplier.update': 'purchasing',
        'purchase.read': 'purchasing',
        'purchase.create': 'purchasing',
        'purchase.approve': 'purchasing',
        'purchase.receive': 'purchasing',
        'payable.manage': 'accounting',
        'expense.read': 'accounting',
        'expense.create': 'accounting',
        'expense.reverse': 'accounting',
        'invoice.read': 'invoicing',
        'invoice.create': 'invoicing',
        'invoice.issue': 'invoicing',
        'invoice.payment': 'invoicing',
        'finance.read': 'accounting',
        'stock.transfer': 'inventory',
        'stock.count': 'inventory',
        'catalog.read': 'catalog',
        'catalog.write': 'catalog',
        'stock.receive': 'inventory',
        'sale.create': 'sales',
        'sale.read': 'sales',
        'sale.refund': 'sales',
        'cash.manage': 'sales',
        'customer.read': 'crm',
        'customer.write': 'crm',
        'report.read': 'reporting',
        'journal.read': 'accounting',
      };
      const business = await tx.business.findFirst({
        where: { id: scope.businessId, tenantId: scope.tenantId },
        select: { industryId: true },
      });
      // Legacy businesses keep their current permissions until an owner configures an industry.
      if (
        business?.industryId &&
        moduleByPermission[permission] &&
        !hasEffectiveModule(business.industryId, moduleByPermission[permission]!)
      )
        throw new DomainError(
          'MODULE_UNAVAILABLE',
          'This business module is unavailable for its selected industry.',
          404,
        );
      if (
        process.env.NODE_ENV === 'production' &&
        ['owner', 'manager', 'accountant'].includes(member.role)
      ) {
        const identity = await tx.$queryRaw<
          { enabled: boolean | null }[]
        >`SELECT "twoFactorEnabled" AS enabled FROM "user" WHERE id=${scope.userId}`;
        if (!identity[0]?.enabled)
          throw new DomainError(
            'MFA_REQUIRED',
            'Set up and verify two-factor authentication before accessing privileged business operations.',
            403,
          );
      }
      const authorized = { ...scope, role: member.role };
      return fn(tx, authorized);
    },
    { maxWait: 10000, timeout: 20000, isolationLevel },
  );
}
export async function write<T extends Prisma.InputJsonValue>(
  scope: Scope,
  permission: Permission,
  operation: string,
  key: string,
  input: unknown,
  fn: (tx: Transaction, authorized: Scope) => Promise<T>,
): Promise<T> {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key))
    throw new DomainError('IDEMPOTENCY_REQUIRED', 'A valid operation key is required.');
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return scoped(scope, permission, async (tx, authorized) => {
    const lockKey = [
      scope.tenantId,
      scope.businessId,
      scope.branchId,
      scope.userId,
      operation,
      key,
    ].join(':');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey},0))`;
    const where = { ...ownership(scope), userId: scope.userId, operation, key };
    const prior = await tx.idempotency.findFirst({ where });
    if (prior) {
      if (prior.hash !== hash)
        throw new DomainError(
          'IDEMPOTENCY_CONFLICT',
          'This operation key was already used with different data.',
          409,
        );
      return prior.result as T;
    }
    const result = await fn(tx, authorized);
    await tx.idempotency.create({
      data: { id: randomUUID(), ...where, hash, result },
    });
    return result;
  });
}
export async function audit(
  tx: Transaction,
  s: Scope,
  action: string,
  entityId: string,
  reason = '',
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      id: randomUUID(),
      ...ownership(s),
      actorId: s.userId,
      action,
      entityId,
      reason,
      requestId: s.requestId,
    },
  });
  await tx.outboxEvent.create({
    data: { id: randomUUID(), ...ownership(s), type: action, entityId },
  });
}
export async function assertOpenPeriod(tx: Transaction, s: Scope): Promise<void> {
  const business = await tx.business.findUniqueOrThrow({ where: { id: s.businessId } });
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: business.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  if (
    await tx.period.findFirst({
      where: {
        tenantId: s.tenantId,
        businessId: s.businessId,
        throughDate: { gte: today },
      },
    })
  )
    throw new DomainError('PERIOD_CLOSED', 'The accounting period is closed.', 409);
}
