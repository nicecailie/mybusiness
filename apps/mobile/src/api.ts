import { createAuthClient } from 'better-auth/react';
import { expoClient } from '@better-auth/expo/client';
import { twoFactorClient } from 'better-auth/client/plugins';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { offlineSaleSchema } from '../../../packages/contracts/src/index';
import {
  queueSql,
  cacheStock,
  localProducts,
  queueRows,
  acknowledgeUpload,
  enqueueOffline,
  type LocalDatabase,
} from './offline-store';
import type {
  Product,
  OfflineSaleInput,
  OfflineResult,
} from '../../../packages/contracts/src/index';
import type { Context, ApiError } from '../../../packages/contracts/src/index';
export const baseURL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
export const authClient = createAuthClient({
  baseURL,
  plugins: [
    expoClient({
      scheme: 'mybusiness',
      storagePrefix: 'mybusiness',
      storage: SecureStore,
    }),
    twoFactorClient(),
  ],
});
export class NativeRequestError extends Error {
  constructor(
    message: string,
    public uncertain: boolean,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  context?: Context,
  body?: unknown,
  operationId?: string,
): Promise<T> {
  const cookie = await authClient.getCookie();
  const response = await fetch(`${baseURL}/api/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie,
      origin: 'mybusiness://',
      ...(context
        ? {
            'x-tenant-id': context.tenantId,
            'x-business-id': context.businessId,
            'x-branch-id': context.branchId,
          }
        : {}),
      ...(operationId ? { 'Idempotency-Key': operationId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const error = (await response.json()) as ApiError;
    throw new NativeRequestError(
      error.message,
      response.status >= 500 || response.status === 429 || response.status === 408,
    );
  }
  return response.json() as Promise<T>;
}
let database: SQLite.SQLiteDatabase | undefined;
let openingDatabase: Promise<SQLite.SQLiteDatabase> | undefined;
async function local() {
  if (!openingDatabase)
    openingDatabase = (async () => {
      database = await SQLite.openDatabaseAsync('mybusiness-drafts.db');
      await database.execAsync(
        'CREATE TABLE IF NOT EXISTS drafts(scope TEXT PRIMARY KEY,payload TEXT NOT NULL)',
      );
      await database.execAsync(queueSql);
      return database;
    })();
  return openingDatabase;
}
export async function saveDraft(scope: string, payload: unknown): Promise<void> {
  const db = await local();
  await db.runAsync(
    'INSERT INTO drafts(scope,payload) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET payload=excluded.payload',
    scope,
    JSON.stringify(payload),
  );
}
export async function loadDraft(scope: string): Promise<unknown> {
  const row = await (
    await local()
  ).getFirstAsync<{ payload: string }>('SELECT payload FROM drafts WHERE scope=?', scope);
  return row ? (JSON.parse(row.payload) as unknown) : null;
}
export async function clearDrafts(): Promise<void> {
  await (await local()).runAsync('DELETE FROM drafts');
}

export const localScope = (c: Context) =>
  [c.userId, c.tenantId, c.businessId, c.branchId].join(':');
export async function offlineDatabase() {
  const db = await local();
  return db as unknown as LocalDatabase;
}
export async function offlineProducts(context: Context) {
  return localProducts(await offlineDatabase(), localScope(context));
}
export async function refreshOfflineProducts(
  context: Context,
  products: Product[],
  syncedAt = new Date().toISOString(),
) {
  await cacheStock(await offlineDatabase(), localScope(context), products, syncedAt);
}
export async function offlineContext(context: Context, value?: unknown): Promise<unknown> {
  const db = await offlineDatabase(),
    scope = localScope(context);
  if (value !== undefined)
    await db.runAsync(
      'INSERT INTO offline_context(scope,payload) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET payload=excluded.payload',
      scope,
      JSON.stringify(value),
    );
  const row = await db.getFirstAsync<{ payload: string }>(
    'SELECT payload FROM offline_context WHERE scope=?',
    scope,
  );
  return row ? JSON.parse(row.payload) : null;
}
const syncing = new Set<string>();
export async function syncOffline(context: Context) {
  const scope = localScope(context);
  if (syncing.has(scope)) return;
  syncing.add(scope);
  try {
    const db = await offlineDatabase(),
      rows = await queueRows(db, scope);
    for (const row of rows.filter((r) => r.upload_status === 'awaiting_upload')) {
      try {
        const input = offlineSaleSchema.parse(JSON.parse(row.payload));
        const result = await api<OfflineResult>('offline/sales', context, input, input.saleId);
        await acknowledgeUpload(db, row.id, result);
      } catch (error) {
        if (
          (error instanceof NativeRequestError && !error.uncertain) ||
          (error instanceof Error && error.name === 'ZodError')
        )
          await db.runAsync(
            "UPDATE offline_sales SET upload_status='upload_blocked',error=? WHERE id=?",
            error.message,
            row.id,
          );
        // Network failures stay awaiting upload. Successful sales requiring review never re-upload.
      }
    }
  } finally {
    syncing.delete(scope);
  }
}
export async function retryOffline(context: Context, id: string) {
  const db = await offlineDatabase();
  await db.runAsync(
    "UPDATE offline_sales SET upload_status='awaiting_upload',error=NULL WHERE scope=? AND id=? AND upload_status='upload_blocked'",
    localScope(context),
    id,
  );
  await syncOffline(context);
}
export async function recordOffline(context: Context, input: OfflineSaleInput) {
  await enqueueOffline(await offlineDatabase(), localScope(context), input);
}
export async function offlineQueue(context: Context) {
  return queueRows(await offlineDatabase(), localScope(context));
}

export async function cachedContexts(userId: string): Promise<Context[]> {
  const key = 'mb_contexts_' + userId;
  try {
    const result = await api<Context[]>('contexts');
    await SecureStore.setItemAsync(key, JSON.stringify(result));
    return result;
  } catch (error) {
    if (error instanceof NativeRequestError) throw error;
    const cached = await SecureStore.getItemAsync(key);
    if (!cached) throw error;
    return (JSON.parse(cached) as Context[]).filter((c) => c.userId === userId);
  }
}
