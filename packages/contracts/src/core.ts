import { z } from 'zod';
import { idSchema, moneySchema, quantitySchema, nonnegativeQuantitySchema } from './index.js';
const text = z.string().trim().max(300);
export const supplierSchema = z
  .object({
    name: text.min(2),
    contact: text.default(''),
    phone: text.default(''),
    email: z.union([z.literal(''), z.email()]).default(''),
    address: text.default(''),
    taxReference: text.default(''),
    notes: text.default(''),
    active: z.boolean().default(true),
  })
  .strict();
const unique = (v: { productId: string }[]) => new Set(v.map((l) => l.productId)).size === v.length;
export const purchaseSchema = z
  .object({
    supplierId: idSchema,
    orderDate: z.iso.date(),
    expectedDate: z.iso.date().optional(),
    notes: text.default(''),
    lines: z
      .array(
        z
          .object({
            productId: idSchema,
            quantity: quantitySchema,
            unitCost: moneySchema.refine((v) => BigInt(v) > 0n),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(unique, 'Combine duplicate products.'),
  })
  .strict()
  .refine(
    (v) => !v.expectedDate || v.expectedDate >= v.orderDate,
    'Delivery date must follow order date.',
  );
export const receiptSchema = z
  .object({
    lines: z
      .array(z.object({ lineId: idSchema, quantity: quantitySchema }).strict())
      .min(1)
      .max(100)
      .refine((v) => new Set(v.map((l) => l.lineId)).size === v.length, 'Combine duplicate lines.'),
  })
  .strict();
export const billSchema = z
  .object({
    receiptId: idSchema,
    reference: text.min(1),
    billDate: z.iso.date(),
    dueDate: z.iso.date(),
  })
  .strict()
  .refine((v) => v.dueDate >= v.billDate, 'Due date must follow bill date.');
export const settlementSchema = z
  .object({
    amount: moneySchema.refine((v) => BigInt(v) > 0n),
    account: z.enum(['1000 Cash', '1010 Bank']),
    reference: text.min(1),
  })
  .strict();
export const categorySchema = z
  .object({ name: text.min(2), kind: z.enum(['running', 'equipment', 'other']).default('running') })
  .strict();
export const expenseSchema = z
  .object({
    categoryId: idSchema,
    supplierId: idSchema.optional(),
    expenseDate: z.iso.date(),
    amount: moneySchema.refine((v) => BigInt(v) > 0n),
    account: z.enum(['1000 Cash', '1010 Bank']),
    description: text.min(3),
    reference: text.default(''),
  })
  .strict();
export const invoiceSchema = z
  .object({
    customerId: idSchema,
    saleId: idSchema.optional(),
    invoiceDate: z.iso.date(),
    dueDate: z.iso.date(),
    notes: text.default(''),
    lines: z
      .array(
        z
          .object({ productId: idSchema, quantity: quantitySchema, unitPrice: moneySchema })
          .strict(),
      )
      .max(100)
      .refine(unique, 'Combine duplicate products.')
      .default([]),
  })
  .strict()
  .refine((v) => v.dueDate >= v.invoiceDate, 'Due date must follow invoice date.')
  .refine(
    (v) => (v.saleId ? v.lines.length === 0 : v.lines.length > 0),
    'Choose an existing sale or enter invoice items.',
  );
export const transferSchema = z
  .object({
    destinationId: idSchema,
    lines: z
      .array(z.object({ productId: idSchema, quantity: quantitySchema }).strict())
      .min(1)
      .max(100)
      .refine(unique, 'Combine duplicate products.'),
  })
  .strict();
export const countSchema = z
  .object({
    notes: text.min(3),
    lines: z
      .array(
        z
          .object({
            productId: idSchema,
            counted: nonnegativeQuantitySchema,
            unitCost: moneySchema,
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(unique, 'Combine duplicate products.'),
  })
  .strict();
export const staffUpdateSchema = z
  .object({
    userId: z.string().min(1).max(128),
    role: z.enum(['manager', 'cashier', 'inventory', 'purchasing', 'accountant', 'viewer']),
    active: z.boolean(),
  })
  .strict();

export const purchaseEntrySchema = z
  .object({
    supplierId: idSchema.optional(),
    supplier: supplierSchema.optional(),
    mode: z.enum(['draft', 'order']),
    orderDate: z.iso.date(),
    expectedDate: z.iso.date().optional(),
    notes: text.default(''),
    lines: z
      .array(
        z
          .object({
            productId: idSchema,
            quantity: quantitySchema,
            unitCost: moneySchema.refine((v) => BigInt(v) > 0n),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(unique, 'Combine duplicate products.'),
  })
  .strict()
  .refine((v) => !!v.supplierId !== !!v.supplier, 'Choose an existing supplier or add a new one.')
  .refine(
    (v) => !v.expectedDate || v.expectedDate >= v.orderDate,
    'Delivery date must follow order date.',
  );
export const purchasePaymentSchema = z
  .object({
    amount: moneySchema.refine((v) => BigInt(v) > 0n).optional(),
    account: z.enum(['1000 Cash', '1010 Bank']),
    reference: text.min(1),
  })
  .strict();
