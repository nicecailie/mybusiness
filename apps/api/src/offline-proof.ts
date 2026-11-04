import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Product, Scope, OfflineSaleInput } from '../../../packages/contracts/src/index.js';
import { DomainError } from '../../../packages/domain/src/index.js';
const proofSchema = z.object({
  userId: z.string(),
  tenantId: z.string(),
  businessId: z.string(),
  branchId: z.string(),
  deviceId: z.string(),
  productId: z.string(),
  name: z.string(),
  sku: z.string(),
  price: z.string(),
  vatBps: z.number().int().optional(),
  onHand: z.number(),
  capturedAt: z.string(),
});
const sign = (payload: string) =>
  createHmac('sha256', process.env.BETTER_AUTH_SECRET!)
    .update('mybusiness-offline-catalog-v1:' + payload)
    .digest('base64url');
export function catalogProof(s: Scope, deviceId: string, p: Product, capturedAt: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      userId: s.userId,
      tenantId: s.tenantId,
      businessId: s.businessId,
      branchId: s.branchId,
      deviceId,
      productId: p.id,
      name: p.name,
      sku: p.sku,
      price: p.price,
      vatBps: p.vatBps ?? 0,
      onHand: p.onHand,
      capturedAt,
    }),
  ).toString('base64url');
  return payload + '.' + sign(payload);
}
export function verifyCatalogProof(
  s: Scope,
  input: OfflineSaleInput,
  line: OfflineSaleInput['lines'][number],
): number {
  try {
    const [payload, signature] = line.catalogProof.split('.');
    if (!payload || !signature) throw new Error();
    const expected = Buffer.from(sign(payload)),
      actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error();
    const proof = proofSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    if (
      proof.userId !== s.userId ||
      proof.tenantId !== s.tenantId ||
      proof.businessId !== s.businessId ||
      proof.branchId !== s.branchId ||
      proof.deviceId !== input.deviceId ||
      proof.productId !== line.productId ||
      proof.price !== line.unitPrice ||
      proof.name !== line.name ||
      proof.sku !== line.sku ||
      proof.capturedAt !== input.lastSyncedAt ||
      line.lastKnownStock > proof.onHand ||
      line.discount !== '0'
    )
      throw new Error();
    return proof.vatBps ?? 0;
  } catch {
    throw new DomainError(
      'OFFLINE_CATALOG_REVIEW',
      'The recorded product details differ from the authorized download. A manager must review this upload.',
      409,
    );
  }
}
