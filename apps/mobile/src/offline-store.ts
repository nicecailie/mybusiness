import {
  cachedProductSchema,
  offlineSaleSchema,
  type OfflineSaleInput,
  type Product,
  type UploadStatus,
} from '../../../packages/contracts/src/index';
// Small SQLite interface shared by Expo and the restart/atomicity tests.
export interface LocalDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
  withExclusiveTransactionAsync(fn: (tx: LocalDatabase) => Promise<void>): Promise<void>;
}
export const queueSql = `
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS drafts(scope TEXT PRIMARY KEY,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS offline_sales(scope TEXT NOT NULL,id TEXT PRIMARY KEY,payload TEXT NOT NULL,upload_status TEXT NOT NULL,review_status TEXT NOT NULL DEFAULT 'none',result TEXT,error TEXT,recorded_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS offline_sales_scope ON offline_sales(scope,upload_status);
CREATE TABLE IF NOT EXISTS local_stock(scope TEXT NOT NULL,product_id TEXT NOT NULL,payload TEXT NOT NULL,estimate REAL NOT NULL,synced_at TEXT NOT NULL,PRIMARY KEY(scope,product_id));
CREATE TABLE IF NOT EXISTS offline_context(scope TEXT PRIMARY KEY,payload TEXT NOT NULL);
`;
export interface QueuedSale {
  id: string;
  payload: string;
  upload_status: UploadStatus;
  review_status: string;
  result: string | null;
  error: string | null;
  recorded_at: string;
}
export async function enqueueOffline(db: LocalDatabase, scope: string, input: OfflineSaleInput) {
  const sale = offlineSaleSchema.parse(input);
  await db.withExclusiveTransactionAsync(async (tx) => {
    const prior = await tx.getFirstAsync<{ payload: string }>(
      'SELECT payload FROM offline_sales WHERE id=?',
      sale.saleId,
    );
    if (prior) {
      if (prior.payload !== JSON.stringify(sale))
        throw new Error('This sale ID already has different recorded details.');
      return;
    }
    for (const l of sale.lines) {
      const product = await tx.getFirstAsync<{ payload: string; estimate: number }>(
        'SELECT payload,estimate FROM local_stock WHERE scope=? AND product_id=?',
        scope,
        l.productId,
      );
      if (!product) throw new Error('Download this product before recording an offline sale.');
      if (cachedProductSchema.parse(JSON.parse(product.payload)).type === 'goods')
        await tx.runAsync(
          'UPDATE local_stock SET estimate=round(estimate-?,3) WHERE scope=? AND product_id=?',
          l.quantity,
          scope,
          l.productId,
        );
    }
    await tx.runAsync(
      'INSERT INTO offline_sales(scope,id,payload,upload_status,recorded_at) VALUES(?,?,?,?,?)',
      scope,
      sale.saleId,
      JSON.stringify(sale),
      'awaiting_upload',
      sale.localTime,
    );
    await tx.runAsync('DELETE FROM drafts WHERE scope=?', scope);
  });
}
export async function cacheStock(
  db: LocalDatabase,
  scope: string,
  products: Product[],
  syncedAt: string,
) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const pending = await tx.getAllAsync<QueuedSale>(
      "SELECT * FROM offline_sales WHERE scope=? AND upload_status IN ('awaiting_upload','upload_blocked')",
      scope,
    );
    await tx.runAsync('DELETE FROM local_stock WHERE scope=?', scope);
    for (const p of products) {
      const uploadedPending = pending
        .map((r) => offlineSaleSchema.parse(JSON.parse(r.payload)))
        .reduce((n, s) => n + (s.lines.find((l) => l.productId === p.id)?.quantity ?? 0), 0);
      await tx.runAsync(
        'INSERT INTO local_stock(scope,product_id,payload,estimate,synced_at) VALUES(?,?,?,?,?) ON CONFLICT(scope,product_id) DO UPDATE SET payload=excluded.payload,estimate=excluded.estimate,synced_at=excluded.synced_at',
        scope,
        p.id,
        JSON.stringify(p),
        Number((p.onHand - (p.type === 'goods' ? uploadedPending : 0)).toFixed(3)),
        syncedAt,
      );
    }
  });
}
export async function localProducts(
  db: LocalDatabase,
  scope: string,
): Promise<{ items: Product[]; syncedAt: string }> {
  const rows = await db.getAllAsync<{ payload: string; estimate: number; synced_at: string }>(
    'SELECT payload,estimate,synced_at FROM local_stock WHERE scope=?',
    scope,
  );
  return {
    items: rows.map((r) => ({
      ...cachedProductSchema.parse(JSON.parse(r.payload)),
      onHand: r.estimate,
    })),
    syncedAt: rows.reduce((n, r) => (n < r.synced_at ? n : r.synced_at), rows[0]?.synced_at ?? ''),
  };
}
export const queueRows = (db: LocalDatabase, scope: string) =>
  db.getAllAsync<QueuedSale>(
    'SELECT * FROM offline_sales WHERE scope=? ORDER BY recorded_at,id',
    scope,
  );
export const acknowledgeUpload = (
  db: LocalDatabase,
  id: string,
  result: { id: string; reviewRequired: boolean },
) =>
  db.runAsync(
    'UPDATE offline_sales SET upload_status=?,review_status=?,result=?,error=NULL WHERE id=?',
    result.reviewRequired ? 'synchronized_review' : 'synchronized',
    result.reviewRequired ? 'required' : 'none',
    JSON.stringify(result),
    id,
  );
