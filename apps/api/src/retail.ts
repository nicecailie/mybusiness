import { adjustStock } from './catalog.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Scope } from '../../../packages/contracts/src/index.js';
import {
  idSchema,
  moneySchema,
  quantitySchema,
  nonnegativeQuantitySchema,
} from '../../../packages/contracts/src/index.js';
import { DomainError, requirePermission } from '../../../packages/domain/src/index.js';
import { audit, scoped, write } from './database.js';
export const variantsSchema = z
  .object({
    variants: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(100),
          sku: z.string().trim().min(1).max(60),
          barcode: z.string().trim().max(80).optional(),
          price: moneySchema,
          cost: moneySchema.optional(),
          quantity: nonnegativeQuantitySchema.optional(),
          expiresOn: z.string().date().optional(),
        }),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const variants = (
  s: Scope,
  key: string,
  id: string,
  input: z.infer<typeof variantsSchema>,
) =>
  write(s, 'catalog.write', 'product.variants', key, { id, ...input }, async (tx, a) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'stock:' + a.branchId + ':' + id},0))`;
    const p = await tx.product.findFirst({
      where: { id, archived: false, parentId: null, systemKind: null },
    });
    if (!p) throw new DomainError('NOT_FOUND', 'Choose a base product.', 404);
    // A populated product keeps its history and stock. New variants are additional SKUs.
    const ids = [];
    for (const v of input.variants) {
      const child = randomUUID();
      await tx.product.create({
        data: {
          id: child,
          tenantId: a.tenantId,
          businessId: a.businessId,
          name: p.name + ' · ' + v.label,
          sku: v.sku,
          barcode: v.barcode || null,
          category: p.category,
          type: p.type,
          price: v.price,
          lowStock: p.lowStock,
          parentId: id,
          variantLabel: v.label,
          batchTracked: p.batchTracked,
          vatBps: p.vatBps,
          recipe: recipeSchema.parse({ ingredients: p.recipe }).ingredients,
        },
      });
      if (v.quantity) {
        requirePermission(a.role, 'stock.receive');
        await adjustStock(
          tx,
          a,
          {
            productId: child,
            quantity: v.quantity,
            unitCost: v.cost ?? '0',
            expiresOn: v.expiresOn,
            reason: 'Variant opening stock',
            direction: 'increase',
          },
          true,
        );
      }
      ids.push(child);
    }
    await audit(tx, a, 'product.variants_created', id);
    return { ids };
  });
export const recipeSchema = z
  .object({
    ingredients: z
      .array(z.object({ productId: idSchema, quantity: quantitySchema }).strict())
      .max(50),
  })
  .strict()
  .refine(
    (v) => new Set(v.ingredients.map((x) => x.productId)).size === v.ingredients.length,
    'Combine duplicate ingredients.',
  );
export const saveRecipe = (
  s: Scope,
  key: string,
  id: string,
  input: z.infer<typeof recipeSchema>,
) =>
  write(s, 'catalog.write', 'product.recipe', key, { id, ...input }, async (tx, a) => {
    const p = await tx.product.findFirst({
      where: { id, archived: false, type: 'service', systemKind: null },
    });
    if (!p)
      throw new DomainError(
        'INVALID_RECIPE',
        'Choose a service menu item; direct goods already deduct their own stock.',
      );
    for (const l of input.ingredients)
      if (
        !(await tx.product.findFirst({
          where: { id: l.productId, type: 'goods', archived: false, isGroup: false },
        }))
      )
        throw new DomainError('NOT_FOUND', 'Choose stock ingredients in this business.', 404);
    await tx.product.update({
      where: { id },
      data: { recipe: input.ingredients, version: { increment: 1 } },
    });
    await audit(tx, a, 'menu.recipe_updated', id);
    return { id };
  });
export const expiryDashboard = (s: Scope) =>
  scoped(s, 'stock.receive', async (tx, a) => {
    const business = await tx.business.findUniqueOrThrow({ where: { id: a.businessId } });
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: business.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const soon = new Date(today + 'T12:00:00Z');
    soon.setUTCDate(soon.getUTCDate() + 30);
    const lots = await tx.stockBatch.findMany({
      where: { onHand: { gt: 0 }, expiresOn: { lte: soon.toISOString().slice(0, 10) } },
      orderBy: { expiresOn: 'asc' },
    });
    const products = await tx.product.findMany({
      where: { id: { in: lots.map((l) => l.productId) } },
    });
    return {
      today,
      items: lots.map((l) => ({
        id: l.id,
        productId: l.productId,
        name: products.find((p) => p.id === l.productId)?.name,
        expiresOn: l.expiresOn,
        quantity: Number(l.onHand),
        status: l.expiresOn < today ? 'expired' : 'expiring',
      })),
    };
  });
export const reorderSuggestion = (s: Scope, id: string) =>
  scoped(s, 'purchase.create', async (tx) => {
    const p = await tx.product.findFirst({ where: { id, archived: false, type: 'goods' } });
    if (!p) throw new DomainError('NOT_FOUND', 'Product not found.', 404);
    const b = await tx.stockBalance.findFirst({ where: { productId: id } });
    const previous = await tx.purchaseLine.findFirst({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
    });
    const order = previous
      ? await tx.purchaseOrder.findFirst({ where: { id: previous.orderId } })
      : null;
    return {
      productId: id,
      supplierId: order?.supplierId ?? null,
      quantity: Math.max(1, Number((Number(p.lowStock) * 2 - Number(b?.onHand ?? 0)).toFixed(3))),
      unitCost: previous?.unitCost.toString() ?? '0',
    };
  });
