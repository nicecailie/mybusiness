import { z } from 'zod';
import * as core from '../../../packages/contracts/src/core.js';
import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import {
  productSchema,
  productUpdateSchema,
  offlineSaleSchema,
  businessDetailsSchema,
  documentSchema,
  receiveSchema,
  saleSchema,
  returnSchema,
  customerSchema,
  openCashSchema,
  closeCashSchema,
} from '../../../packages/contracts/src/index.js';
// Nest's transport decorators do not infer Zod models. Export the canonical schemas explicitly.
export function attachContracts(document: OpenAPIObject): void {
  document.security = [{ cookie: [] }];
  for (const route of ['/api/v1/contexts', '/api/v1/health']) {
    const op = document.paths[route]?.get;
    if (op) {
      op.parameters = [];
      if (route.endsWith('/health')) op.security = [];
    }
  }
  const commands: Record<string, z.ZodType> = {
    '/api/v1/suppliers': core.supplierSchema,
    '/api/v1/suppliers/{id}': core.supplierSchema,
    '/api/v1/purchases': core.purchaseSchema,
    '/api/v1/purchases/{id}/update': core.purchaseSchema,
    '/api/v1/purchases/{id}/receive': core.receiptSchema,
    '/api/v1/payables': core.billSchema,
    '/api/v1/payables/{id}/payments': core.settlementSchema,
    '/api/v1/expense-categories': core.categorySchema,
    '/api/v1/expenses': core.expenseSchema,
    '/api/v1/expenses/{id}/reverse': z
      .object({ reason: z.string().trim().min(3).max(300) })
      .strict(),
    '/api/v1/invoices': core.invoiceSchema,
    '/api/v1/invoices/{id}/payments': core.settlementSchema,
    '/api/v1/transfers': core.transferSchema,
    '/api/v1/stock-counts': core.countSchema,
    '/api/v1/staff/update': core.staffUpdateSchema,
    '/api/v1/products': productSchema,
    '/api/v1/products/{id}/update': productUpdateSchema,
    '/api/v1/offline/sales': offlineSaleSchema,
    '/api/v1/business': businessDetailsSchema,
    '/api/v1/business/documents': documentSchema,
    '/api/v1/stock/opening': receiveSchema,
    '/api/v1/customers': customerSchema,
    '/api/v1/cash-session': openCashSchema,
    '/api/v1/cash-session/{id}/close': closeCashSchema,
    '/api/v1/sales': saleSchema,
    '/api/v1/sales/{id}/returns': returnSchema,
  };
  for (const [path, schema] of Object.entries(commands)) {
    const operation = document.paths[path]?.post;
    if (!operation) continue;
    operation.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: z.toJSONSchema(schema, { target: 'openapi-3.0' }) as SchemaObject,
        },
      },
    };
    operation.parameters ??= [];
    operation.parameters.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: true,
      schema: { type: 'string', minLength: 16, maxLength: 100 },
    });
  }
  const error: SchemaObject = {
    type: 'object',
    required: ['code', 'message', 'requestId'],
    properties: {
      code: { type: 'string' },
      message: { type: 'string' },
      requestId: { type: 'string' },
      fieldErrors: {
        type: 'object',
        additionalProperties: { type: 'array', items: { type: 'string' } },
      },
    },
  };
  for (const path of Object.values(document.paths))
    for (const method of ['get', 'post', 'delete'] as const) {
      const operation = path[method];
      if (!operation) continue;
      for (const status of ['400', '401', '403', '404', '409', '500'])
        operation.responses[status] = {
          description: 'Stable safe error with correlation identifier',
          content: { 'application/json': { schema: error } },
        };
    }
}
