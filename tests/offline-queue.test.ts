import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  queueSql,
  enqueueOffline,
  cacheStock,
  localProducts,
  queueRows,
  acknowledgeUpload,
  type LocalDatabase,
} from '../apps/mobile/src/offline-store.js';
import type { OfflineSaleInput, Product } from '../packages/contracts/src/index.js';
function adapter(connection: DatabaseSync): LocalDatabase {
  const db: LocalDatabase = {
    execAsync: async (sql) => {
      connection.exec(sql);
    },
    runAsync: async (sql, ...args) => connection.prepare(sql).run(...args),
    getFirstAsync: async <T>(sql: string, ...args: (string | number | null)[]) =>
      connection.prepare(sql).get(...args) as T | null,
    getAllAsync: async <T>(sql: string, ...args: (string | number | null)[]) =>
      connection.prepare(sql).all(...args) as T[],
    withExclusiveTransactionAsync: async (fn) => {
      connection.exec('BEGIN IMMEDIATE');
      try {
        await fn(db);
        connection.exec('COMMIT');
      } catch (e) {
        connection.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return db;
}
const id = () => randomUUID();
void test('durable SQLite queue survives a process-style reopen, updates fractional estimates atomically and stops uploading review-required sales', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mybusiness-review-')),
    path = join(dir, 'queue.sqlite'),
    scope = 'actor:business:branch';
  let connection = new DatabaseSync(path),
    db = adapter(connection);
  await db.execAsync(queueSql);
  const p: Product = {
    id: id(),
    name: 'Fabric',
    sku: 'FAB',
    barcode: null,
    category: 'Fabric',
    type: 'goods',
    price: '1000',
    onHand: 6,
    lowStock: 0.5,
    archived: false,
  };
  await cacheStock(db, scope, [p], '2026-10-29T08:00:00.000Z');
  const sale: OfflineSaleInput = {
    saleId: id(),
    deviceId: id(),
    userId: 'actor',
    tenantId: id(),
    businessId: id(),
    branchId: id(),
    localTime: '2026-10-29T09:00:00.000Z',
    lastSyncedAt: '2026-10-29T08:00:00.000Z',
    cashSessionId: id(),
    tendered: '1250',
    total: '1250',
    payment: { method: 'card', reference: 'CARD-123' },
    reason: '',
    lines: [
      {
        productId: p.id,
        name: p.name,
        sku: p.sku,
        quantity: 1.25,
        unitPrice: p.price,
        discount: '0',
        total: '1250',
        lastKnownStock: 6,
        catalogProof: 'test-proof',
      },
    ],
  };
  await db.runAsync(
    'INSERT INTO drafts(scope,payload) VALUES(?,?)',
    scope,
    JSON.stringify({ operationId: sale.saleId }),
  );
  await enqueueOffline(db, scope, sale);
  assert.equal((await localProducts(db, scope)).items[0]?.onHand, 4.75);
  assert.equal(await db.getFirstAsync('SELECT * FROM drafts WHERE scope=?', scope), undefined);
  await enqueueOffline(db, scope, sale);
  assert.equal((await localProducts(db, scope)).items[0]?.onHand, 4.75);
  connection.close();
  connection = new DatabaseSync(path);
  db = adapter(connection);
  await db.execAsync(queueSql);
  assert.equal((await queueRows(db, scope)).length, 1);
  assert.equal((await localProducts(db, scope)).items[0]?.onHand, 4.75);
  assert.deepEqual(JSON.parse((await queueRows(db, scope))[0]!.payload), sale);
  // A server commit with no local acknowledgement stays queued with exactly the original ID.
  const retry = JSON.parse((await queueRows(db, scope))[0]!.payload) as OfflineSaleInput;
  assert.equal(retry.saleId, sale.saleId);
  await acknowledgeUpload(db, sale.saleId, { id: sale.saleId, reviewRequired: true });
  assert.equal(
    (await queueRows(db, scope)).filter((r) => r.upload_status === 'awaiting_upload').length,
    0,
  );
  assert.equal((await queueRows(db, scope))[0]?.upload_status, 'synchronized_review');
  assert.equal((await queueRows(db, 'another-business')).length, 0);
  await cacheStock(db, scope, [{ ...p, onHand: -4 }], '2026-10-29T09:05:00.000Z');
  assert.equal((await localProducts(db, scope)).items[0]?.onHand, -4);
  connection.close();
  await rm(dir, { recursive: true });
});
void test('a failed queue transaction rolls back both the stock estimate and sale and preserves the draft', async () => {
  const connection = new DatabaseSync(':memory:'),
    db = adapter(connection);
  await db.execAsync(queueSql);
  const scope = 'rollback';
  const p: Product = {
    id: id(),
    name: 'Fabric',
    sku: 'FAB',
    barcode: null,
    category: 'Fabric',
    type: 'goods',
    price: '1000',
    onHand: 6,
    lowStock: 1,
    archived: false,
  };
  await cacheStock(db, scope, [p], '2026-10-29T08:00:00.000Z');
  await db.runAsync('INSERT INTO drafts(scope,payload) VALUES(?,?)', scope, 'retained');
  const line = {
    productId: p.id,
    name: p.name,
    sku: p.sku,
    quantity: 1,
    unitPrice: p.price,
    discount: '0',
    total: '1000',
    lastKnownStock: 6,
    catalogProof: 'test-proof',
  };
  const sale: OfflineSaleInput = {
    saleId: id(),
    deviceId: id(),
    userId: 'actor',
    tenantId: id(),
    businessId: id(),
    branchId: id(),
    localTime: '2026-10-29T09:00:00.000Z',
    lastSyncedAt: '2026-10-29T08:00:00.000Z',
    cashSessionId: id(),
    tendered: '2000',
    total: '2000',
    payment: { method: 'cash' },
    reason: '',
    lines: [line, { ...line, productId: id() }],
  };
  await assert.rejects(() => enqueueOffline(db, scope, sale));
  assert.equal((await queueRows(db, scope)).length, 0);
  assert.equal((await localProducts(db, scope)).items[0]?.onHand, 6);
  assert.equal(
    (await db.getFirstAsync<{ payload: string }>('SELECT payload FROM drafts WHERE scope=?', scope))
      ?.payload,
    'retained',
  );
  connection.close();
});
