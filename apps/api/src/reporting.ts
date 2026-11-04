import type {
  Scope,
  Dashboard,
  JournalView,
  Product,
} from '../../../packages/contracts/src/index.js';
import { scoped, type Transaction } from './database.js';
import { receipt } from './sales.js';

export async function dashboard(s: Scope, from: string, to: string): Promise<Dashboard> {
  return scoped(s, 'report.read', (tx, a) => dashboardInTransaction(tx, a, from, to));
}
export async function dashboardInTransaction(
  tx: Transaction,
  a: Scope,
  from: string,
  to: string,
): Promise<Dashboard> {
  const business = await tx.business.findUniqueOrThrow({
      where: { id: a.businessId },
    }),
    tz = business.timezone;
  const totals = await tx.$queryRaw<
    {
      sales: string;
      cost: string;
      refunds: string;
      returnCost: string;
      count: bigint;
      cash: string;
      pending: bigint;
      unverified: bigint;
    }[]
  >`
   SELECT (SELECT count(*) FROM sales WHERE valuation_pending AND (created_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date) AS pending,
   (SELECT count(*) FROM payments WHERE status='recorded_unverified' AND (created_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date) AS unverified,
   COALESCE((SELECT sum(total) FROM sales WHERE (created_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date),0)::text AS sales,
   COALESCE((SELECT sum(cost) FROM sales WHERE (created_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date),0)::text AS cost,
   COALESCE((SELECT sum(total) FROM returns WHERE (created_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date),0)::text AS refunds,
   COALESCE((SELECT sum(cost) FROM returns WHERE (created_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date),0)::text AS "returnCost",
   (SELECT count(*) FROM sales WHERE (created_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date) AS count,
   COALESCE((SELECT sum(CASE direction WHEN 'in' THEN amount ELSE -amount END) FROM payments WHERE method='cash' AND status='confirmed' AND (created_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date),0)::text AS cash`;
  const t = totals[0];
  if (!t) throw new Error('Missing aggregate');
  const trend = await tx.$queryRaw<
    { date: string; sales: string }[]
  >`SELECT d::date::text AS date, COALESCE(sum(v.amount),0)::text AS sales FROM generate_series(${from}::date,${to}::date,'1 day') d LEFT JOIN (SELECT (created_at AT TIME ZONE ${tz})::date AS day,total AS amount FROM sales UNION ALL SELECT (created_at AT TIME ZONE ${tz})::date,-total FROM returns) v ON v.day=d::date GROUP BY d ORDER BY d`;
  const lowStock = await tx.$queryRaw<
    Product[]
  >`SELECT p.id,p.name,p.sku,p.barcode,p.category,p.type,p.price::text,COALESCE(b.on_hand,0)::float8 AS "onHand",p.low_stock::float8 AS "lowStock",p.archived FROM products p LEFT JOIN stock_balances b ON b.product_id=p.id WHERE NOT p.archived AND p.type='goods' AND COALESCE(b.on_hand,0)<=p.low_stock ORDER BY COALESCE(b.on_hand,0),p.name LIMIT 8`;
  const topProducts = await tx.$queryRaw<
    { name: string; quantity: number; sales: string }[]
  >`SELECT name,sum(qty)::float8 AS quantity,sum(value)::text AS sales FROM (SELECT l.name,l.quantity AS qty,l.total AS value FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE (s.created_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date UNION ALL SELECT sl.name,-rl.quantity,-rl.total FROM return_lines rl JOIN returns r ON r.id=rl.return_id JOIN sale_lines sl ON sl.id=rl.sale_line_id WHERE (r.created_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date) v GROUP BY name ORDER BY sum(value) DESC LIMIT 5`;
  const recentRows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM sales WHERE (created_at AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date ORDER BY created_at DESC LIMIT 6`;
  const recent = [];
  for (const row of recentRows) recent.push(await receipt(tx, a, row.id));
  return {
    valuationPending: Number(t.pending) > 0,
    unverifiedPayments: Number(t.unverified),
    netSales: (BigInt(t.sales) - BigInt(t.refunds)).toString(),
    grossProfit: (
      BigInt(t.sales) -
      BigInt(t.refunds) -
      BigInt(t.cost) +
      BigInt(t.returnCost)
    ).toString(),
    refunds: t.refunds,
    cashCollected: t.cash,
    transactionCount: Number(t.count),
    trend,
    lowStock,
    topProducts,
    recent,
    freshness: new Date().toISOString(),
    currency: business.currency,
    timezone: tz,
    from,
    to,
  };
}
export const journals = (s: Scope, page: number, limit: number) =>
  scoped(s, 'journal.read', async (tx) => {
    const rows = await tx.journal.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: (page - 1) * limit,
      }),
      total = await tx.journal.count();
    const lines = await tx.journalLine.findMany({
      where: { journalId: { in: rows.map((r) => r.id) } },
    });
    return {
      total,
      items: rows.map(
        (r) =>
          ({
            id: r.id,
            sourceType: r.sourceType,
            sourceId: r.sourceId,
            createdAt: r.createdAt.toISOString(),
            lines: lines
              .filter((l) => l.journalId === r.id)
              .map((l) => ({
                account: l.account,
                debit: l.debit.toString(),
                credit: l.credit.toString(),
              })),
          }) satisfies JournalView,
      ),
    };
  });
