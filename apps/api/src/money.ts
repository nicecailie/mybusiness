import type { Prisma } from '@prisma/client';
import type { Scope } from '../../../packages/contracts/src/index.js';
import { scoped } from './database.js';
import { financialReportInTransaction, marginPercentage } from './core.js';
const json = (v: unknown): Prisma.JsonValue => JSON.parse(JSON.stringify(v)) as Prisma.JsonValue;
export const moneyOverview = (s: Scope, from: string, to: string) =>
  scoped(s, 'finance.read', async (tx, a) => {
    const report = (await financialReportInTransaction(tx, a, from, to)) as {
      restaurantRevenue: string;
      accommodationRevenue: string;
      revenue: string;
      cogs: string;
      grossProfit: string;
      stockLoss: string;
      expenses: string;
      netOperatingProfit: string;
      inventoryValue: string;
      valuationPending: boolean;
      receivables: {
        id: string;
        balance: string;
        number: string;
        customerName?: string;
        dueDate: string;
      }[];
      payables: {
        id: string;
        balance: string;
        reference: string;
        supplierName?: string;
        dueDate: string;
      }[];
      productPerformance: {
        productId: string;
        productName: string;
        category: string;
        quantity: string;
        revenue: string;
        cost: string;
        grossProfit: string;
        marginPercent: string | null;
      }[];
      inventory: { id: string; productId: string; onHand: string; value: string }[];
    };
    const business = await tx.business.findUniqueOrThrow({ where: { id: a.businessId } });
    const sums = await tx.$queryRaw<
      { account: string; debit: string; credit: string }[]
    >`SELECT l.account,sum(l.debit)::text AS debit,sum(l.credit)::text AS credit FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE (j.created_at AT TIME ZONE ${business.timezone})::date BETWEEN ${from}::date AND ${to}::date GROUP BY l.account`;
    const net = (prefix: string) =>
      sums
        .filter((l) => l.account.startsWith(prefix))
        .reduce((n, l) => n + BigInt(l.debit) - BigInt(l.credit), 0n);
    const cash = sums.find((l) => l.account === '1000 Cash');
    const current = await tx.$queryRaw<
      { account: string; balance: string }[]
    >`SELECT account,sum(debit-credit)::text AS balance FROM journal_lines GROUP BY account`;
    const balance = (code: string) =>
      current.filter((l) => l.account.startsWith(code)).reduce((n, l) => n + BigInt(l.balance), 0n);
    const receipts = await tx.goodsReceipt.findMany(),
      orders = await tx.purchaseOrder.findMany(),
      suppliers = await tx.supplier.findMany(),
      expenses = await tx.expense.findMany(),
      categories = await tx.expenseCategory.findMany();
    const source = await tx.$queryRaw<
      { id: string; sourceType: string; sourceId: string; date: string; amount: string }[]
    >`SELECT j.id,j.source_type AS "sourceType",j.source_id AS "sourceId",(j.created_at AT TIME ZONE ${business.timezone})::date::text AS date,sum(l.debit-l.credit)::text AS amount FROM journals j JOIN journal_lines l ON l.journal_id=j.id WHERE j.source_type IN ('purchase_receipt','expense','expense_reversal') AND (l.account='1200 Inventory' OR l.account LIKE '6%' OR l.account='1500 Equipment') AND (j.created_at AT TIME ZONE ${business.timezone})::date BETWEEN ${from}::date AND ${to}::date GROUP BY j.id,j.source_type,j.source_id,j.created_at`;
    const spending = source
      .map((row) => {
        if (row.sourceType === 'purchase_receipt') {
          const receipt = receipts.find((r) => r.id === row.sourceId),
            order = orders.find((o) => o.id === receipt?.orderId);
          return {
            ...row,
            kind: 'purchase',
            reference: order?.number ?? '',
            name: suppliers.find((s) => s.id === order?.supplierId)?.name ?? '',
            purchaseId: order?.id,
          };
        }
        const expense = expenses.find((e) => e.id === row.sourceId),
          category = categories.find((c) => c.id === expense?.categoryId);
        return {
          ...row,
          kind:
            expense?.postingAccount === '1500 Equipment'
              ? 'equipment'
              : expense?.postingAccount === '6100 Other spending'
                ? 'other'
                : 'running',
          reference: expense?.reference ?? '',
          name: expense?.description ?? '',
          categoryName: category?.name,
          expenseId: expense?.id,
          reversal: row.sourceType === 'expense_reversal',
        };
      })
      .sort((x, y) => y.date.localeCompare(x.date) || y.id.localeCompare(x.id));
    const productNames = await tx.product.findMany();
    const grouped = new Map<string, { category: string; revenue: bigint; cost: bigint }>();
    for (const product of report.productPerformance) {
      const group = grouped.get(product.category) ?? {
        category: product.category,
        revenue: 0n,
        cost: 0n,
      };
      group.revenue += BigInt(product.revenue);
      group.cost += BigInt(product.cost);
      grouped.set(product.category, group);
    }
    return json({
      from,
      to,
      currency: business.currency,
      valuationPending: report.valuationPending,
      metrics: {
        sales: report.revenue,
        costOfGoods: report.cogs,
        profitOnSales: report.grossProfit,
        runningCosts: report.expenses,
        stockLoss: report.stockLoss,
        profitAfterCosts: report.netOperatingProfit,
        customersOwe: (balance('1300') + balance('1400')).toString(),
        restaurantRevenue: report.restaurantRevenue,
        accommodationRevenue: report.accommodationRevenue,
        guestDepositsHeld: (-balance('2300')).toString(),
        suppliersOwed: (-balance('2000') - balance('2100')).toString(),
        stockValue: report.inventoryValue,
        cashIn: cash?.debit ?? '0',
        cashOut: cash?.credit ?? '0',
      },
      costsByType: {
        running: net('6000').toString(),
        other: net('6100').toString(),
        equipment: net('1500').toString(),
        purchase: spending
          .filter((s) => s.kind === 'purchase')
          .reduce((n, s) => n + BigInt(s.amount), 0n)
          .toString(),
      },
      receivables: report.receivables,
      payables: report.payables,
      spending,
      productPerformance: report.productPerformance,
      categoryPerformance: [...grouped.values()].map((g) => ({
        category: g.category,
        revenue: g.revenue.toString(),
        cost: g.cost.toString(),
        grossProfit: (g.revenue - g.cost).toString(),
        marginPercent: marginPercentage(g.revenue.toString(), g.cost.toString()),
      })),
      inventory: report.inventory.map((i) => ({
        ...i,
        name: productNames.find((p) => p.id === i.productId)?.name,
      })),
    });
  });
