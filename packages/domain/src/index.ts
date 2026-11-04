import type { Permission, Role } from '../../contracts/src/index.js';

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}
export function amount(value: string): bigint {
  if (!/^(0|[1-9]\d{0,14})$/.test(value))
    throw new DomainError('INVALID_AMOUNT', 'Use whole BIF amounts within the supported range.');
  return BigInt(value);
}
export function cashTotals(
  lines: { price: string; quantity: number }[],
  tendered: string,
): { total: string; change: string } {
  const total = lines.reduce((sum, l) => {
    return sum + lineAmount(l.price, l.quantity);
  }, 0n);
  const cash = amount(tendered);
  if (total <= 0n) throw new DomainError('INVALID_AMOUNT', 'The sale total must be positive.');
  if (total > 999999999999999n)
    throw new DomainError('INVALID_AMOUNT', 'The sale exceeds the supported amount.');
  if (cash < total)
    throw new DomainError('INSUFFICIENT_PAYMENT', 'Cash received is less than the sale total.');
  return { total: total.toString(), change: (cash - total).toString() };
}
export const grants: Record<Role, readonly Permission[]> = {
  owner: [
    'supplier.read',
    'supplier.create',
    'supplier.update',
    'purchase.read',
    'purchase.create',
    'purchase.approve',
    'purchase.receive',
    'payable.manage',
    'expense.read',
    'expense.create',
    'expense.reverse',
    'invoice.read',
    'invoice.create',
    'invoice.issue',
    'invoice.payment',
    'finance.read',
    'stock.transfer',
    'stock.count',
    'team.update',
    'business.manage',
    'catalog.read',
    'catalog.write',
    'stock.receive',
    'sale.create',
    'sale.read',
    'sale.refund',
    'cash.manage',
    'customer.read',
    'customer.write',
    'report.read',
    'journal.read',
  ],
  manager: [
    'supplier.read',
    'supplier.create',
    'supplier.update',
    'purchase.read',
    'purchase.create',
    'purchase.approve',
    'purchase.receive',
    'payable.manage',
    'expense.read',
    'expense.create',
    'expense.reverse',
    'invoice.read',
    'invoice.create',
    'invoice.issue',
    'invoice.payment',
    'finance.read',
    'stock.transfer',
    'stock.count',
    'team.update',
    'business.manage',
    'catalog.read',
    'catalog.write',
    'stock.receive',
    'sale.create',
    'sale.read',
    'sale.refund',
    'cash.manage',
    'customer.read',
    'customer.write',
    'report.read',
    'journal.read',
  ],
  cashier: [
    'catalog.read',
    'sale.create',
    'sale.read',
    'cash.manage',
    'customer.read',
    'customer.write',
  ],
  inventory: [
    'catalog.read',
    'catalog.write',
    'stock.receive',
    'purchase.read',
    'purchase.receive',
    'stock.transfer',
    'stock.count',
  ],
  purchasing: [
    'catalog.read',
    'supplier.read',
    'supplier.create',
    'supplier.update',
    'purchase.read',
    'purchase.create',
    'purchase.approve',
    'purchase.receive',
  ],
  accountant: [
    'purchase.read',
    'supplier.read',
    'payable.manage',
    'expense.read',
    'expense.create',
    'expense.reverse',
    'invoice.read',
    'invoice.create',
    'invoice.issue',
    'invoice.payment',
    'finance.read',
    'catalog.read',
    'sale.read',
    'customer.read',
    'report.read',
    'journal.read',
  ],
  viewer: [
    'catalog.read',
    'sale.read',
    'report.read',
    'supplier.read',
    'purchase.read',
    'invoice.read',
    'expense.read',
    'finance.read',
  ],
};
export function can(role: Role, permission: Permission): boolean {
  return grants[role].includes(permission);
}
export function requirePermission(role: Role, permission: Permission): void {
  if (!can(role, permission))
    throw new DomainError('FORBIDDEN', 'Your role does not allow this action.', 403);
}
export interface PostingLine {
  account: string;
  debit: string;
  credit: string;
}
export function assertBalanced(lines: PostingLine[]): void {
  if (lines.length < 2 || lines.some((l) => amount(l.debit) > 0n === amount(l.credit) > 0n))
    throw new DomainError('INVALID_JOURNAL', 'Every line must have one positive debit or credit.');
  if (lines.reduce((s, l) => s + amount(l.debit) - amount(l.credit), 0n) !== 0n)
    throw new DomainError('UNBALANCED_JOURNAL', 'Journal debits and credits must balance.');
}
export function salePosting(total: string, cost: string): PostingLine[] {
  const lines = [
    { account: '1000 Cash', debit: total, credit: '0' },
    { account: '4000 Sales', debit: '0', credit: total },
  ];
  if (amount(cost) > 0n)
    lines.push(
      { account: '5000 Cost of sales', debit: cost, credit: '0' },
      { account: '1200 Inventory', debit: '0', credit: cost },
    );
  assertBalanced(lines);
  return lines;
}
export function reversePosting(lines: PostingLine[]): PostingLine[] {
  return lines.map((l) => ({
    account: l.account,
    debit: l.credit,
    credit: l.debit,
  }));
}
export function safeCsv(value: string): string {
  return `"${(/^[=+\-@\t\r]/.test(value) ? "'" : '') + value.replaceAll('"', '""')}"`;
}

// Scale quantities to integers before arithmetic to avoid floating-point money errors.
export function quantityUnits(quantity: number): bigint {
  const units = Math.round(quantity * 1000);
  if (
    !Number.isFinite(quantity) ||
    !Number.isSafeInteger(units) ||
    Math.abs(quantity * 1000 - units) > 0.000001 ||
    Math.abs(quantity) > 1000000000000
  )
    throw new DomainError('INVALID_QUANTITY', 'Use quantities with at most three decimal places.');
  return BigInt(units);
}
export function lineAmount(price: string, quantity: number): bigint {
  const units = quantityUnits(quantity);
  if (units <= 0n) throw new DomainError('INVALID_QUANTITY', 'Quantity must be positive.');
  return (amount(price) * units + 500n) / 1000n;
}
export function allocatedCost(value: string, quantity: number, available: number): bigint {
  if (quantity <= 0 || available <= 0 || quantity > available)
    throw new DomainError('INVALID_VALUATION', 'Only available stock can be valued.');
  return (
    (BigInt(value) * quantityUnits(quantity) + quantityUnits(available) / 2n) /
    quantityUnits(available)
  );
}
export function stayNights(from: string, to: string): number {
  const nights = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000;
  if (!Number.isInteger(nights) || nights < 1 || nights > 366)
    throw new DomainError('INVALID_STAY', 'Checkout must be after check-in (maximum 366 nights).');
  return nights;
}
