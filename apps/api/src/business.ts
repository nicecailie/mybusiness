import { bookStay, hotelBoard } from './hotel.js';
import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { Scope } from '../../../packages/contracts/src/index.js';
import { documentSchema, businessDetailsSchema } from '../../../packages/contracts/src/index.js';
import { audit, scoped, write, ownership } from './database.js';
import { DomainError } from '../../../packages/domain/src/index.js';
import { hasEffectiveModule } from '../../../packages/domain/src/industries.js';

export const businessDetails = (s: Scope) =>
  scoped(s, 'business.manage', async (tx, a) => ({
    business: await tx.business.findUniqueOrThrow({ where: { id: a.businessId } }),
    documents: await tx.businessDocument.findMany({
      select: {
        id: true,
        name: true,
        mime: true,
        actorId: true,
        createdAt: true,
        replacesId: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  }));
export const updateBusiness = (
  s: Scope,
  key: string,
  input: ReturnType<typeof businessDetailsSchema.parse>,
) =>
  write(s, 'business.manage', 'business.update', key, input, async (tx, a) => {
    await tx.business.update({ where: { id: a.businessId }, data: input });
    await audit(tx, a, 'business.updated', a.businessId);
    return { id: a.businessId };
  });
export function validateDocument(input: ReturnType<typeof documentSchema.parse>) {
  const bytes = Buffer.from(input.data, 'base64');
  const valid =
    input.mime === 'application/pdf'
      ? bytes.subarray(0, 5).toString() === '%PDF-'
      : input.mime === 'image/png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid || bytes.length > 210000)
    throw new DomainError('INVALID_DOCUMENT', 'Upload a PDF, PNG or JPEG up to 200 KB.');
  return bytes;
}
export const addDocument = (
  s: Scope,
  key: string,
  input: ReturnType<typeof documentSchema.parse>,
  replacesId?: string,
) =>
  write(s, 'business.manage', 'business.document', key, { input, replacesId }, async (tx, a) => {
    if (replacesId && !(await tx.businessDocument.findFirst({ where: { id: replacesId } })))
      throw new DomainError('NOT_FOUND', 'Original document not found in this business.', 404);
    validateDocument(input);
    const id = randomUUID();
    await tx.businessDocument.create({
      data: {
        id,
        tenantId: a.tenantId,
        businessId: a.businessId,
        actorId: a.userId,
        replacesId,
        ...input,
      },
    });
    await audit(tx, a, 'business.document_added', id, input.name);
    return { id };
  });
export const getDocument = (s: Scope, id: string) =>
  scoped(s, 'business.manage', (tx) => tx.businessDocument.findFirst({ where: { id } }));
export const staff = (s: Scope) =>
  scoped(
    s,
    'business.manage',
    (tx, a) =>
      tx.$queryRaw`SELECT * FROM list_business_staff(${a.userId},${a.businessId}::uuid,${a.branchId}::uuid)`,
  );
export async function addStaff(
  s: Scope,
  key: string,
  input: { name: string; email: string; role: string; password: string },
) {
  const passwordHash = await hashPassword(input.password);
  // Hash outside the transaction; the operation fingerprint contains no plaintext password.
  return write(
    s,
    'business.manage',
    'staff.create',
    key,
    { name: input.name, email: input.email, role: input.role },
    async (tx, a) => {
      if (a.role === 'manager' && input.role === 'manager')
        throw new DomainError('FORBIDDEN', 'Only an owner can add managers.', 403);
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT add_business_staff(${a.userId},${a.tenantId}::uuid,${a.businessId}::uuid,${a.branchId}::uuid,${input.email},${input.name},${input.role},${passwordHash}) AS id`;
      const id = rows[0]!.id;
      // Audit entity IDs are UUIDs; record the account ID in the reason for existing non-UUID identities.
      await audit(
        tx,
        a,
        'staff.added',
        a.businessId,
        JSON.stringify({ userId: id, role: input.role }),
      );
      return { id };
    },
  );
}
async function accommodation(tx: Parameters<Parameters<typeof scoped>[2]>[0], s: Scope) {
  const b = await tx.business.findUniqueOrThrow({ where: { id: s.businessId } });
  if (!b.industryId || !hasEffectiveModule(b.industryId, 'accommodation'))
    throw new DomainError(
      'MODULE_UNAVAILABLE',
      'Accommodation is unavailable for this business.',
      404,
    );
}
export const rooms = hotelBoard;
export const addRoom = (s: Scope, key: string, input: { name: string; rate: string }) =>
  write(s, 'business.manage', 'room.create', key, input, async (tx, a) => {
    await accommodation(tx, a);
    const id = randomUUID();
    await tx.room.create({ data: { id, ...ownership(a), ...input } });
    await audit(tx, a, 'room.created', id);
    return { id };
  });
export const addStay = (
  s: Scope,
  key: string,
  input: { roomId: string; customerId: string; checkIn: string; checkOut: string },
) => bookStay(s, key, { ...input, guestCount: 1 });
