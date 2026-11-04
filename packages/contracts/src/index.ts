import { z } from 'zod';

export const moneySchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,14})$/, 'Enter a whole, nonnegative BIF amount.');
// Quantities use thousandths; money remains whole BIF, rounded per line.
export const quantitySchema = z
  .number()
  .positive()
  .max(1000000)
  .refine(
    (v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 0.000001,
    'Use at most three decimal places.',
  );
export const nonnegativeQuantitySchema = quantitySchema.or(z.literal(0));
export const paymentEvidenceSchema = z
  .object({
    method: z.enum(['cash', 'card', 'mobile_money']),
    provider: z.enum(['Lumicash', 'Ecocash', 'iHela']).optional(),
    reference: z.string().trim().max(160).optional(),
  })
  .strict()
  .refine(
    (v) => v.method !== 'mobile_money' || (!!v.provider && !!v.reference),
    'Select the mobile-money provider and enter the transaction reference.',
  );
export const documentSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    mime: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
    data: z
      .string()
      .max(280000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
export const businessDetailsSchema = z
  .object({
    nif: z.string().trim().max(80).default(''),
    tva: z.string().trim().max(80).default(''),
    offlinePolicy: z.enum(['warning_reason', 'manager_override']).default('warning_reason'),
  })
  .strict();
export const idSchema = z.string().uuid();
export const pageSchema = z.object({
  search: z.string().max(100).default(''),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const productSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    sku: z.string().trim().min(1).max(60),
    barcode: z.string().trim().max(80).optional(),
    category: z.string().trim().min(1).max(60),
    price: moneySchema,
    cost: moneySchema,
    lowStock: nonnegativeQuantitySchema.default(5),
    type: z.enum(['goods', 'service']).default('goods'),
    initialQuantity: nonnegativeQuantitySchema.optional(),
    vatBps: z.number().int().min(0).max(10000).optional(),
    batchTracked: z.boolean().optional(),
    expiresOn: z.string().date().optional(),
    initialReason: z.string().trim().min(3).max(300).optional(),
  })
  .strict();
export const receiveSchema = z
  .object({
    expiresOn: z.string().date().optional(),
    productId: idSchema,
    quantity: quantitySchema,
    unitCost: moneySchema,
    direction: z.enum(['increase', 'decrease']).optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();
export const cartLineSchema = z.object({ productId: idSchema, quantity: quantitySchema }).strict();
export const saleSchema = z
  .object({
    lines: z.array(cartLineSchema).min(1).max(100),
    tendered: moneySchema,
    customerId: idSchema.optional(),
    cashSessionId: idSchema,
    payment: paymentEvidenceSchema.optional(),
  })
  .strict()
  .refine(
    (v) => new Set(v.lines.map((l) => l.productId)).size === v.lines.length,
    'Combine duplicate product lines.',
  );
export const offlineSaleSchema = z
  .object({
    saleId: idSchema,
    deviceId: idSchema,
    userId: z.string().min(1),
    tenantId: idSchema,
    businessId: idSchema,
    branchId: idSchema,
    localTime: z.iso.datetime({ offset: true }),
    lastSyncedAt: z.iso.datetime({ offset: true }),
    cashSessionId: idSchema,
    customerId: idSchema.optional(),
    tendered: moneySchema,
    total: moneySchema,
    payment: paymentEvidenceSchema,
    reason: z.string().trim().max(300),
    lines: z
      .array(
        z
          .object({
            productId: idSchema,
            name: z.string().min(1).max(160),
            sku: z.string().min(1).max(60),
            quantity: quantitySchema,
            unitPrice: moneySchema,
            discount: moneySchema,
            total: moneySchema,
            catalogProof: z.string().min(1).max(4000),
            lastKnownStock: z.number().min(-1000000).max(1000000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (v) => new Set(v.lines.map((l) => l.productId)).size === v.lines.length,
    'Combine duplicate lines.',
  );
export type OfflineSaleInput = z.infer<typeof offlineSaleSchema>;
export type UploadStatus =
  'awaiting_upload' | 'synchronized' | 'synchronized_review' | 'upload_blocked';
export interface OfflineResult {
  id: string;
  reviewRequired: boolean;
}
export const returnSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            saleLineId: idSchema,
            quantity: quantitySchema,
            disposition: z.enum(['restockable', 'damaged']),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    reason: z.string().trim().min(3).max(300),
    cashSessionId: idSchema,
  })
  .strict()
  .refine(
    (v) => new Set(v.lines.map((l) => l.saleLineId)).size === v.lines.length,
    'Combine duplicate return lines.',
  );
export const customerSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    phone: z.string().trim().max(40),
    email: z.union([z.literal(''), z.email()]).default(''),
  })
  .strict();
export const openCashSchema = z.object({ openingFloat: moneySchema }).strict();
export const closeCashSchema = z
  .object({ counted: moneySchema, reason: z.string().trim().max(300) })
  .strict();
export const reportSchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((v) => v.from <= v.to, 'Start date must precede end date.')
  .refine(
    (v) => Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
    'Choose at most 366 days.',
  );
export const productUpdateSchema = productSchema.omit({
  initialQuantity: true,
  initialReason: true,
});
export const onboardingSchema = z
  .object({
    industryId: z.enum([
      'clothing_store',
      'furniture_store',
      'grocery_store',
      'hardware_store',
      'other_retail',
      'bar_pub',
      'restaurant',
      'fast_food',
      'guest_house',
      'beverage_distributor',
      'hotel',
      'spa_resort',
      'real_estate_agency',
      'construction_company',
      'property_management',
      'gardening',
      'eyewear_store',
      'fitness_center',
      'pharmacy',
      'hair_salon',
      'handyman',
      'it_hardware_support',
      'solar_energy_system',
      'electronic_store',
      'cleaning_services',
    ]),
    fullName: z.string().trim().min(2).max(160),
    companyName: z.string().trim().min(2).max(120),
    email: z.email().max(254),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
    country: z.string().regex(/^[A-Z]{2}$/),
    locale: z.enum(['fr', 'en']).default('en'),
    companySize: z.enum(['1-5', '6-20', '21-50', '51-200', '201+']).default('1-5'),
    primaryInterest: z.enum(['company', 'explore']).default('company'),
    demoData: z.boolean().default(false),
    acceptLegal: z.literal(true),
    nif: z.string().trim().max(80).optional(),
    tva: z.string().trim().max(80).optional(),
    documents: z.array(documentSchema).max(3).optional(),
    projects: z
      .array(
        z
          .object({
            name: z.string().trim().min(2).max(120),
            industryId: z.string().min(1).max(80),
          })
          .strict(),
      )
      .max(2)
      .optional(),
  })
  .strict();
export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type SaleInput = z.infer<typeof saleSchema>;
export type ReturnInput = z.infer<typeof returnSchema>;
export type ReceiveInput = z.infer<typeof receiveSchema>;
export type CustomerInput = z.infer<typeof customerSchema>;
export type Role =
  | 'owner'
  | 'manager'
  | 'cashier'
  | 'inventory'
  | 'accountant'
  | 'viewer'
  | 'purchasing'
  | 'waiter'
  | 'kitchen'
  | 'receptionist'
  | 'housekeeping';
export type Permission =
  | 'business.manage'
  | 'catalog.read'
  | 'catalog.write'
  | 'stock.receive'
  | 'sale.create'
  | 'sale.read'
  | 'sale.refund'
  | 'cash.manage'
  | 'customer.read'
  | 'customer.write'
  | 'report.read'
  | 'journal.read'
  | 'supplier.read'
  | 'supplier.create'
  | 'supplier.update'
  | 'purchase.read'
  | 'purchase.create'
  | 'purchase.approve'
  | 'purchase.receive'
  | 'payable.manage'
  | 'expense.read'
  | 'expense.create'
  | 'expense.reverse'
  | 'invoice.read'
  | 'invoice.create'
  | 'invoice.issue'
  | 'invoice.payment'
  | 'finance.read'
  | 'stock.transfer'
  | 'stock.count'
  | 'team.update'
  | 'restaurant.read'
  | 'restaurant.order'
  | 'restaurant.prepare'
  | 'restaurant.pay'
  | 'hotel.read'
  | 'hotel.book'
  | 'hotel.checkout'
  | 'hotel.clean';
export interface Scope {
  userId: string;
  tenantId: string;
  businessId: string;
  branchId: string;
  role: Role;
  requestId: string;
}
export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  category: string;
  type: string;
  price: string;
  cost?: string;
  onHand: number;
  lowStock: number;
  archived: boolean;
  offlineProof?: string;
  parentId?: string | null;
  variantLabel?: string | null;
  recipe?: { productId: string; quantity: number }[];
  isGroup?: boolean;
  batchTracked?: boolean;
  vatBps?: number;
}
export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
}
export interface Context {
  userId: string;
  tenantId: string;
  businessId: string;
  businessName: string;
  branchId: string;
  branchName: string;
  role: Role;
  currency: string;
  timezone: string;
  locale: string;
  demo: boolean;
  industryId: string | null;
}
export interface ReceiptLine {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: string;
  total: string;
  returned: number;
}
export interface Receipt {
  tax?: string;
  offline?: boolean;
  syncedAt?: string;
  reviewRequired?: boolean;
  valuationPending?: boolean;
  payment?: { method: string; provider: string | null; reference: string | null; status: string };

  id: string;
  number: string;
  createdAt: string;
  total: string;
  tendered: string;
  change: string;
  customerName: string | null;
  branchName: string;
  businessName: string;
  currency: string;
  lines: ReceiptLine[];
  returnedTotal: string;
}
export interface CashSession {
  id: string;
  openingFloat: string;
  expected: string;
  status: string;
  openedAt: string;
  counted: string | null;
  variance: string | null;
}
export interface Dashboard {
  valuationPending?: boolean;
  unverifiedPayments?: number;
  netSales: string;
  grossProfit: string;
  refunds: string;
  cashCollected: string;
  transactionCount: number;
  lowStock: Product[];
  trend: { date: string; sales: string }[];
  topProducts: { name: string; quantity: number; sales: string }[];
  recent: Receipt[];
  freshness: string;
  currency: string;
  timezone: string;
  from: string;
  to: string;
}
export interface JournalView {
  id: string;
  sourceType: string;
  sourceId: string;
  createdAt: string;
  lines: { account: string; debit: string; credit: string }[];
}
export interface ApiError {
  code: string;
  message: string;
  requestId: string;
  fieldErrors?: Record<string, string[]>;
}

// Local storage and SQLite are untrusted boundaries too. Empty tender is valid only for a draft.
export const cachedProductSchema = z.object({
  batchTracked: z.boolean().optional(),
  id: idSchema,
  name: z.string().max(160),
  sku: z.string().max(60),
  barcode: z.string().nullable(),
  category: z.string().max(60),
  type: z.enum(['goods', 'service']),
  price: moneySchema,
  cost: moneySchema.optional(),
  onHand: z.number().min(-1000000).max(1000000),
  lowStock: nonnegativeQuantitySchema,
  archived: z.boolean(),
  offlineProof: z.string().max(4000).optional(),
});
export const cashDraftSchema = z.object({
  lines: z.array(cartLineSchema).max(100),
  tendered: z.union([z.literal(''), moneySchema]),
  operationId: idSchema,
  pending: z.boolean(),
  submitted: saleSchema.optional(),
});
export const webDraftSchema = cashDraftSchema.extend({
  customerId: z.union([z.literal(''), idSchema]),
  products: z.array(cachedProductSchema).max(200).optional(),
});
