import * as purchasing from './purchasing.js';
import { moneyOverview } from './money.js';
import * as core from './core.js';
import { attachContracts } from './openapi.js';
import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import {
  Module,
  Controller,
  Get,
  Post,
  Delete,
  Req,
  Res,
  Param,
  Body,
  Query,
  UseFilters,
  Catch,
  type ExceptionFilter,
  type ArgumentsHost,
} from '@nestjs/common';
import { SwaggerModule, DocumentBuilder, ApiHeader, ApiOperation } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z, ZodError } from 'zod';
import * as c from '../../../packages/contracts/src/index.js';
import { DomainError, can, safeCsv } from '../../../packages/domain/src/index.js';
import { auth } from './auth.js';
import { contexts, scoped } from './database.js';
import {
  products,
  createProduct,
  receiveStock,
  createCustomer,
  archiveProduct,
  updateProduct,
  restoreProduct,
} from './catalog.js';
import {
  finalizeSale,
  returnSale,
  getReceipt,
  receipt as getReceiptInTransaction,
  listSales,
} from './sales.js';
import { cashSession, openCash, closeCash } from './cash.js';
import { dashboard, dashboardInTransaction, journals } from './reporting.js';
import {
  addTable,
  createOrder,
  payOrder,
  restaurantDashboard,
  orderSchema,
  orderPaymentSchema,
} from './restaurant.js';
import {
  registerDevice,
  offlineCatalog,
  ingestOfflineSale,
  reconciliation,
  resolveDiscrepancy,
} from './offline.js';
import {
  businessDetails,
  updateBusiness,
  addDocument,
  getDocument,
  staff,
  addStaff,
  rooms,
  addRoom,
  addStay,
} from './business.js';
import { activatePendingBusiness, provisionBusiness } from './onboarding.js';

async function user(req: Request): Promise<string> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session) throw new DomainError('UNAUTHORIZED', 'Sign in to continue.', 401);
  return session.user.id;
}
async function scope(req: Request): Promise<c.Scope> {
  const userId = await user(req);
  const tenantId = c.idSchema.parse(req.header('x-tenant-id')),
    businessId = c.idSchema.parse(req.header('x-business-id')),
    branchId = c.idSchema.parse(req.header('x-branch-id'));
  return {
    userId,
    tenantId,
    businessId,
    branchId,
    role: 'viewer',
    requestId: randomUUID(),
  };
}
const key = (req: Request): string => req.header('idempotency-key') ?? '';
@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = randomUUID();
    let status = 500,
      code = 'INTERNAL_ERROR',
      message = 'The operation could not be completed. Retry with the same operation key.';
    let fieldErrors: Record<string, string[]> | undefined;
    if (error instanceof DomainError) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (error instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = error.issues[0]?.message ?? 'Check the entered values.';
      fieldErrors = {};
      for (const issue of error.issues) {
        const name = issue.path.join('.');
        fieldErrors[name] ??= [];
        fieldErrors[name].push(issue.message);
      }
    } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      status = 409;
      code = 'DUPLICATE_RECORD';
      message = 'This record already exists. Check the product code, barcode, or active register.';
    } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      status = 409;
      code = 'VERSION_CONFLICT';
      message = 'Another operation changed these records. Retry with the same operation key.';
    }
    if (status === 500)
      console.error(
        JSON.stringify({
          level: 'error',
          requestId,
          errorType: error instanceof Error ? error.name : 'unknown',
        }),
      );
    res.status(status).json({
      code,
      message,
      requestId,
      ...(fieldErrors ? { fieldErrors } : {}),
    });
  }
}
@Controller('api/v1')
@UseFilters(Errors)
@ApiHeader({ name: 'x-tenant-id', required: true })
@ApiHeader({ name: 'x-business-id', required: true })
@ApiHeader({ name: 'x-branch-id', required: true })
class ApiController {
  @Get('suppliers') async coreSuppliers(@Req() req: Request, @Query() query: unknown) {
    const q = c.pageSchema.parse(query);
    return core.suppliers(await scope(req), q.search, q.page);
  }
  @Post('suppliers') async coreSaveSupplier(@Req() req: Request, @Body() body: unknown) {
    return core.saveSupplier(await scope(req), key(req), body);
  }
  @Get('suppliers/:id') async coreSupplier(@Req() req: Request, @Param('id') id: string) {
    return core.supplierDetail(await scope(req), c.idSchema.parse(id));
  }
  @Post('suppliers/:id') async coreUpdateSupplier(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return core.saveSupplier(await scope(req), key(req), body, c.idSchema.parse(id));
  }
  @Get('purchasing') async purchasingWorkspace(@Req() req: Request, @Query() query: unknown) {
    const q = c.pageSchema.parse(query),
      id = z.object({ id: c.idSchema.optional() }).parse(query).id;
    return purchasing.purchaseWorkspace(await scope(req), q.page, q.search, id);
  }
  @Post('purchasing') async enterPurchase(@Req() req: Request, @Body() body: unknown) {
    return purchasing.enterPurchase(await scope(req), key(req), body);
  }
  @Post('purchasing/:id/update') async editPurchaseEntry(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return purchasing.enterPurchase(await scope(req), key(req), body, c.idSchema.parse(id));
  }
  @Post('purchasing/:id/receive') async receivePurchaseEntry(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return purchasing.receiveAndBill(await scope(req), key(req), c.idSchema.parse(id), body);
  }
  @Post('purchasing/:id/pay') async payPurchaseEntry(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return purchasing.payPurchase(await scope(req), key(req), c.idSchema.parse(id), body);
  }
  @Get('money') async money(@Req() req: Request, @Query() query: unknown) {
    const q = c.reportSchema.parse(query);
    return moneyOverview(await scope(req), q.from, q.to);
  }
  @Get('purchases') async corePurchases(@Req() req: Request, @Query() query: unknown) {
    return core.purchases(await scope(req), c.pageSchema.parse(query).page);
  }
  @Post('purchases') async coreSavePurchase(@Req() req: Request, @Body() body: unknown) {
    return core.savePurchase(await scope(req), key(req), body);
  }
  @Get('purchases/:id') async corePurchase(@Req() req: Request, @Param('id') id: string) {
    return core.purchaseDetail(await scope(req), c.idSchema.parse(id));
  }
  @Post('purchases/:id/update') async coreUpdatePurchase(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return core.savePurchase(await scope(req), key(req), body, c.idSchema.parse(id));
  }
  @Post('purchases/:id/order') async coreOrder(@Req() req: Request, @Param('id') id: string) {
    return core.purchaseAction(await scope(req), key(req), c.idSchema.parse(id), 'order');
  }
  @Post('purchases/:id/cancel') async coreCancelOrder(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return core.purchaseAction(await scope(req), key(req), c.idSchema.parse(id), 'cancel');
  }
  @Post('purchases/:id/receive') async coreReceive(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return core.receivePurchase(await scope(req), key(req), c.idSchema.parse(id), body);
  }
  @Get('payables') async corePayables(@Req() req: Request) {
    return core.payables(await scope(req));
  }
  @Post('payables') async coreBill(@Req() req: Request, @Body() body: unknown) {
    return core.createBill(await scope(req), key(req), body);
  }
  @Post('payables/:id/payments') async corePayBill(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return core.settle(await scope(req), key(req), c.idSchema.parse(id), body, 'bill');
  }
  @Get('expense-categories') async coreCategories(@Req() req: Request) {
    return core.categories(await scope(req));
  }
  @Post('expense-categories') async coreCategory(@Req() req: Request, @Body() body: unknown) {
    return core.createCategory(await scope(req), key(req), body);
  }
  @Get('expenses') async coreExpenses(@Req() req: Request, @Query() query: unknown) {
    const q = c.reportSchema.parse(query);
    const category = z.object({ categoryId: c.idSchema.optional() }).parse(query).categoryId;
    return core.expenses(await scope(req), q.from, q.to, category);
  }
  @Post('expenses') async coreExpense(@Req() req: Request, @Body() body: unknown) {
    return core.createExpense(await scope(req), key(req), body);
  }
  @Post('expenses/:id/reverse') async coreReverseExpense(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return core.reverseExpense(
      await scope(req),
      key(req),
      c.idSchema.parse(id),
      z
        .object({ reason: z.string().trim().min(3).max(300) })
        .strict()
        .parse(body).reason,
    );
  }
  @Get('invoices') async coreInvoices(@Req() req: Request) {
    return core.invoices(await scope(req));
  }
  @Post('invoices') async coreInvoice(@Req() req: Request, @Body() body: unknown) {
    return core.createInvoice(await scope(req), key(req), body);
  }
  @Get('invoices/:id') async coreInvoiceDetail(@Req() req: Request, @Param('id') id: string) {
    return core.invoiceDetail(await scope(req), c.idSchema.parse(id));
  }
  @Post('invoices/:id/issue') async coreIssue(@Req() req: Request, @Param('id') id: string) {
    return core.issueInvoice(await scope(req), key(req), c.idSchema.parse(id));
  }
  @Post('invoices/:id/void') async coreVoid(@Req() req: Request, @Param('id') id: string) {
    return core.voidInvoice(await scope(req), key(req), c.idSchema.parse(id));
  }
  @Post('invoices/:id/payments') async corePayInvoice(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return core.settle(await scope(req), key(req), c.idSchema.parse(id), body, 'invoice');
  }
  @Get('customers/:id/balance') async coreCustomerBalance(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return core.customerBalance(await scope(req), c.idSchema.parse(id));
  }
  @Get('transfers') async coreTransfers(@Req() req: Request) {
    return core.transfers(await scope(req));
  }
  @Post('transfers') async coreTransfer(@Req() req: Request, @Body() body: unknown) {
    return core.createTransfer(await scope(req), key(req), body);
  }
  @Post('transfers/:id/:action') async coreTransferAction(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('action') action: string,
  ) {
    return core.transferAction(
      await scope(req),
      key(req),
      c.idSchema.parse(id),
      z.enum(['send', 'receive', 'cancel']).parse(action),
    );
  }
  @Get('stock-counts') async coreCounts(@Req() req: Request) {
    return core.counts(await scope(req));
  }
  @Post('stock-counts') async coreCount(@Req() req: Request, @Body() body: unknown) {
    return core.createCount(await scope(req), key(req), body);
  }
  @Post('stock-counts/:id/finalize') async coreFinalizeCount(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return core.finalizeCount(await scope(req), key(req), c.idSchema.parse(id));
  }
  @Get('reports/branches') async coreBranches(@Req() req: Request, @Query() query: unknown) {
    const q = c.reportSchema.parse(query);
    return core.branchPerformance(await scope(req), q.from, q.to);
  }
  @Get('reports/financial') async coreFinancial(@Req() req: Request, @Query() query: unknown) {
    const q = c.reportSchema.parse(query);
    return core.financialReport(await scope(req), q.from, q.to);
  }
  @Post('staff/update') async coreStaffUpdate(@Req() req: Request, @Body() body: unknown) {
    return core.updateStaff(await scope(req), key(req), body);
  }
  @Get('workspace') async coreWorkspace(@Req() req: Request) {
    return core.focusedWorkspace(await scope(req));
  }
  @Get('health') health(): { status: string } {
    return { status: 'ok' };
  }
  @Get('contexts') async context(@Req() req: Request) {
    return contexts(await user(req));
  }
  @Post('onboarding') async onboard(@Req() req: Request, @Body() body: unknown) {
    const actor = await user(req);
    const input = c.onboardingSchema.parse(body);
    const key = req.header('idempotency-key') ?? '';
    return provisionBusiness(actor, key, input);
  }
  @Post('onboarding/activate') async activate(@Req() req: Request) {
    return activatePendingBusiness(await user(req));
  }
  @Get('products') async products(@Req() req: Request, @Query() query: unknown) {
    const q = c.pageSchema.parse(query);
    return products(
      await scope(req),
      q.search,
      q.page,
      q.limit,
      z.object({ archived: z.enum(['true', 'false']).default('false') }).parse(query).archived ===
        'true',
    );
  }
  @Post('products')
  @ApiOperation({ summary: 'Create product; Idempotency-Key required' })
  async createProduct(@Req() req: Request, @Body() body: unknown) {
    return createProduct(await scope(req), key(req), c.productSchema.parse(body));
  }
  @Delete('products/:id') async archive(@Req() req: Request, @Param('id') id: string) {
    return archiveProduct(await scope(req), key(req), c.idSchema.parse(id));
  }
  @Post('stock/opening') async receive(@Req() req: Request, @Body() body: unknown) {
    return receiveStock(await scope(req), key(req), c.receiveSchema.parse(body));
  }
  @Post('products/:id/update') async updateProduct(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return updateProduct(
      await scope(req),
      key(req),
      c.idSchema.parse(id),
      c.productUpdateSchema.parse(body),
    );
  }
  @Post('products/:id/restore') async restoreProduct(@Req() req: Request, @Param('id') id: string) {
    return restoreProduct(await scope(req), key(req), c.idSchema.parse(id));
  }
  @Post('offline/devices') async registerDevice(@Req() req: Request, @Body() body: unknown) {
    return registerDevice(await scope(req), z.object({ id: c.idSchema }).parse(body).id);
  }
  @Post('offline/catalog') async offlineCatalog(@Req() req: Request, @Body() body: unknown) {
    return offlineCatalog(
      await scope(req),
      z.object({ deviceId: c.idSchema }).strict().parse(body).deviceId,
    );
  }
  @Post('offline/sales') async offlineSale(@Req() req: Request, @Body() body: unknown) {
    return ingestOfflineSale(await scope(req), c.offlineSaleSchema.parse(body));
  }
  @Get('reconciliation') async reconciliation(@Req() req: Request) {
    return reconciliation(await scope(req));
  }
  @Post('reconciliation/:id') async resolve(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return resolveDiscrepancy(
      await scope(req),
      key(req),
      c.idSchema.parse(id),
      z
        .object({
          action: z.enum([
            'stock_adjustment',
            'missing_delivery',
            'refund',
            'sale_correction',
            'cancellation',
            'outstanding_fulfillment',
          ]),
          reason: z.string().trim().min(3).max(300),
          referenceId: c.idSchema.optional(),
          quantity: c.quantitySchema.optional(),
        })
        .strict()
        .parse(body),
    );
  }
  @Get('business') async business(@Req() req: Request) {
    return businessDetails(await scope(req));
  }
  @Post('business') async updateBusiness(@Req() req: Request, @Body() body: unknown) {
    return updateBusiness(await scope(req), key(req), c.businessDetailsSchema.parse(body));
  }
  @Post('business/documents') async addDocument(@Req() req: Request, @Body() body: unknown) {
    return addDocument(await scope(req), key(req), c.documentSchema.parse(body));
  }
  @Post('business/documents/:id/update') async reviseDocument(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return addDocument(
      await scope(req),
      key(req),
      c.documentSchema.parse(body),
      c.idSchema.parse(id),
    );
  }
  @Get('business/documents/:id') async document(
    @Req() req: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const doc = await getDocument(await scope(req), c.idSchema.parse(id));
    if (!doc) throw new DomainError('NOT_FOUND', 'Document not found.', 404);
    return res.type(doc.mime).attachment(doc.name).send(Buffer.from(doc.data, 'base64'));
  }
  @Get('staff') async staff(@Req() req: Request) {
    return staff(await scope(req));
  }
  @Post('staff') async addStaff(@Req() req: Request, @Body() body: unknown) {
    return addStaff(
      await scope(req),
      key(req),
      z
        .object({
          name: z.string().trim().min(2).max(160),
          email: z.email().max(254),
          password: z.string().min(12).max(128),
          role: z.enum(['manager', 'cashier', 'inventory', 'purchasing', 'accountant', 'viewer']),
        })
        .strict()
        .parse(body),
    );
  }
  @Get('restaurant') async restaurant(@Req() req: Request) {
    return restaurantDashboard(await scope(req));
  }
  @Post('restaurant/tables') async table(@Req() req: Request, @Body() body: unknown) {
    return addTable(
      await scope(req),
      key(req),
      z
        .object({ name: z.string().trim().min(1).max(80) })
        .strict()
        .parse(body).name,
    );
  }
  @Post('restaurant/orders') async order(@Req() req: Request, @Body() body: unknown) {
    return createOrder(await scope(req), key(req), orderSchema.parse(body));
  }
  @Post('restaurant/orders/:id/pay') async payOrder(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return payOrder(
      await scope(req),
      key(req),
      c.idSchema.parse(id),
      orderPaymentSchema.parse(body),
    );
  }
  @Get('accommodation') async rooms(@Req() req: Request) {
    return rooms(await scope(req));
  }
  @Post('accommodation/rooms') async room(@Req() req: Request, @Body() body: unknown) {
    return addRoom(
      await scope(req),
      key(req),
      z
        .object({
          name: z.string().trim().min(1).max(80),
          rate: c.moneySchema.refine((v) => BigInt(v) > 0n),
        })
        .strict()
        .parse(body),
    );
  }
  @Post('accommodation/stays') async stay(@Req() req: Request, @Body() body: unknown) {
    return addStay(
      await scope(req),
      key(req),
      z
        .object({
          roomId: c.idSchema,
          customerId: c.idSchema,
          checkIn: z.iso.date(),
          checkOut: z.iso.date(),
        })
        .strict()
        .parse(body),
    );
  }
  @Get('stock/movements') async movements(@Req() req: Request, @Query() query: unknown) {
    const q = c.pageSchema.parse(query);
    return scoped(await scope(req), 'stock.receive', async (tx) => ({
      items: await tx.stockMovement.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      total: await tx.stockMovement.count(),
    }));
  }
  @Get('customers') async customers(@Req() req: Request, @Query() query: unknown) {
    const q = c.pageSchema.parse(query);
    return scoped(await scope(req), 'customer.read', async (tx) => {
      const where = {
        archived: false,
        name: { contains: q.search, mode: 'insensitive' as const },
      };
      return {
        items: await tx.customer.findMany({
          where,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          orderBy: { name: 'asc' },
        }),
        total: await tx.customer.count({ where }),
      };
    });
  }
  @Post('customers') async customer(@Req() req: Request, @Body() body: unknown) {
    return createCustomer(await scope(req), key(req), c.customerSchema.parse(body));
  }
  @Get('cash-session') async cash(@Req() req: Request, @Res() res: Response) {
    return res.json(await cashSession(await scope(req)));
  }
  @Post('cash-session') async openCash(@Req() req: Request, @Body() body: unknown) {
    return openCash(await scope(req), key(req), c.openCashSchema.parse(body).openingFloat);
  }
  @Post('cash-session/:id/close') async closeCash(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = c.closeCashSchema.parse(body);
    return closeCash(await scope(req), key(req), c.idSchema.parse(id), data.counted, data.reason);
  }
  @Get('sales') async sales(@Req() req: Request, @Query() query: unknown) {
    const q = c.pageSchema.parse(query);
    return listSales(await scope(req), q.search, q.page, q.limit);
  }
  @Post('sales') async sell(@Req() req: Request, @Body() body: unknown) {
    return finalizeSale(await scope(req), key(req), c.saleSchema.parse(body));
  }
  @Get('sales/:id') async receipt(@Req() req: Request, @Param('id') id: string) {
    return getReceipt(await scope(req), c.idSchema.parse(id));
  }
  @Post('sales/:id/returns') async returns(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return returnSale(await scope(req), key(req), c.idSchema.parse(id), c.returnSchema.parse(body));
  }
  @Get('dashboard') async dashboard(@Req() req: Request, @Query() query: unknown) {
    const q = c.reportSchema.parse(query);
    return dashboard(await scope(req), q.from, q.to);
  }
  @Get('journals') async journal(@Req() req: Request, @Query() query: unknown) {
    const q = c.pageSchema.parse(query);
    return journals(await scope(req), q.page, q.limit);
  }
  @Get('audit') async audit(@Req() req: Request, @Query() query: unknown) {
    const q = c.pageSchema.parse(query);
    return scoped(await scope(req), 'journal.read', async (tx) => ({
      items: await tx.auditEvent.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      total: await tx.auditEvent.count(),
    }));
  }
  @Get('reports/sales.csv') async exportSales(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: unknown,
  ) {
    const q = c.reportSchema.parse(query),
      s = await scope(req);
    const csv = await scoped(
      s,
      'report.read',
      async (tx, a) => {
        if (!can(a.role, 'journal.read'))
          throw new DomainError('FORBIDDEN', 'Your role cannot export financial reports.', 403);
        const data = await dashboardInTransaction(tx, a, q.from, q.to);
        const business = await tx.business.findUniqueOrThrow({ where: { id: a.businessId } });
        const sales = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM sales WHERE (created_at AT TIME ZONE ${business.timezone})::date BETWEEN ${q.from}::date AND ${q.to}::date ORDER BY created_at,id`;
        const rows: string[][] = [
          ['Business', business.name],
          ['Branch', a.branchId],
          ['NIF', business.nif],
          ['TVA', business.tva],
          ['Period', q.from, q.to],
          ['Currency', business.currency],
          ['Net sales', data.netSales],
          ['Refunds', data.refunds],
          ['Gross profit (provisional if cost pending)', data.grossProfit],
          ['Cash collected', data.cashCollected],
          ['Inventory valuation', data.valuationPending ? 'Review required' : 'Recorded costs'],
          [],
          ['Date', 'Net sales (BIF)'],
          ...data.trend.map((t) => [t.date, t.sales]),
          [],
          [
            'Receipt',
            'Sale time',
            'Synchronized at',
            'Total',
            'Returned total',
            'Offline',
            'Review status',
            'Cost status',
            'Payment',
            'Provider',
            'Reference',
            'Payment status',
          ],
        ];
        for (const row of sales) {
          const r = await getReceiptInTransaction(tx, a, row.id);
          rows.push([
            r.number,
            r.createdAt,
            r.syncedAt ?? '',
            r.total,
            r.returnedTotal,
            String(r.offline),
            r.reviewRequired ? 'Review required' : 'Synchronized',
            r.valuationPending ? 'Pending shortage valuation' : 'Recorded',
            r.payment?.method ?? '',
            r.payment?.provider ?? '',
            r.payment?.reference ?? '',
            r.payment?.status ?? '',
          ]);
          for (const l of r.lines)
            rows.push(['Line', l.name, l.sku, String(l.quantity), l.unitPrice, l.total]);
        }
        const movements = await tx.$queryRaw<
          {
            created_at: Date;
            product_id: string;
            quantity: string;
            reason: string;
            actor_id: string;
            source_type: string;
          }[]
        >`SELECT created_at,product_id,quantity::text,reason,actor_id,source_type FROM stock_movements WHERE (created_at AT TIME ZONE ${business.timezone})::date BETWEEN ${q.from}::date AND ${q.to}::date ORDER BY created_at`;
        rows.push([], ['Stock time', 'Product ID', 'Quantity', 'Reason', 'Author', 'Source']);
        for (const m of movements)
          rows.push([
            m.created_at.toISOString(),
            m.product_id,
            m.quantity,
            m.reason,
            m.actor_id,
            m.source_type,
          ]);
        const refunds = await tx.$queryRaw<
          { id: string; total: string; reason: string; created_at: Date }[]
        >`SELECT id,total::text,reason,created_at FROM returns WHERE (created_at AT TIME ZONE ${business.timezone})::date BETWEEN ${q.from}::date AND ${q.to}::date ORDER BY created_at`;
        rows.push([], ['Return ID', 'Amount', 'Reason', 'Time']);
        for (const r of refunds) rows.push([r.id, r.total, r.reason, r.created_at.toISOString()]);
        const payments = await tx.$queryRaw<
          {
            sale_id: string;
            method: string;
            provider: string | null;
            reference: string | null;
            status: string;
            amount: string;
            direction: string;
            created_at: Date;
          }[]
        >`SELECT sale_id,method,provider,reference,status,amount::text,direction,created_at FROM payments WHERE (created_at AT TIME ZONE ${business.timezone})::date BETWEEN ${q.from}::date AND ${q.to}::date ORDER BY created_at`;
        rows.push(
          [],
          [
            'Payment sale ID',
            'Method',
            'Provider',
            'Reference',
            'Status',
            'Amount',
            'Direction',
            'Recorded at',
          ],
        );
        for (const p of payments)
          rows.push([
            p.sale_id,
            p.method,
            p.provider ?? '',
            p.reference ?? '',
            p.status,
            p.amount,
            p.direction,
            p.created_at.toISOString(),
          ]);
        const journals = await tx.$queryRaw<
          {
            id: string;
            source_type: string;
            source_id: string;
            created_at: Date;
            account: string;
            debit: string;
            credit: string;
          }[]
        >`SELECT j.id,j.source_type,j.source_id,j.created_at,l.account,l.debit::text,l.credit::text FROM journals j JOIN journal_lines l ON l.journal_id=j.id WHERE (j.created_at AT TIME ZONE ${business.timezone})::date BETWEEN ${q.from}::date AND ${q.to}::date ORDER BY j.created_at,j.id,l.account`;
        rows.push(
          [],
          ['Journal ID', 'Source', 'Source ID', 'Posted at', 'Account', 'Debit', 'Credit'],
        );
        for (const j of journals)
          rows.push([
            j.id,
            j.source_type,
            j.source_id,
            j.created_at.toISOString(),
            j.account,
            j.debit,
            j.credit,
          ]);
        const corrections = await tx.$queryRaw<
          {
            discrepancy_id: string;
            action: string;
            reason: string;
            actor_id: string;
            reference_id: string | null;
            created_at: Date;
          }[]
        >`SELECT discrepancy_id,action,reason,actor_id,reference_id,created_at FROM reconciliation_events WHERE (created_at AT TIME ZONE ${business.timezone})::date BETWEEN ${q.from}::date AND ${q.to}::date ORDER BY created_at`;
        rows.push([], ['Discrepancy ID', 'Correction', 'Reason', 'Author', 'Reference', 'Time']);
        for (const e of corrections)
          rows.push([
            e.discrepancy_id,
            e.action,
            e.reason,
            e.actor_id,
            e.reference_id ?? '',
            e.created_at.toISOString(),
          ]);
        const stays = await tx.$queryRaw<
          {
            id: string;
            room: string;
            guest: string;
            check_in: string;
            check_out: string;
            nights: number;
            rate: string;
            total: string;
          }[]
        >`SELECT s.id,r.name AS room,c.name AS guest,s.check_in,s.check_out,s.nights,s.rate::text,s.total::text FROM stays s JOIN rooms r ON r.id=s.room_id JOIN customers c ON c.id=s.customer_id WHERE s.check_in<=${q.to} AND s.check_out>${q.from} ORDER BY s.check_in`;
        rows.push(
          [],
          [
            'Stay ID',
            'Room',
            'Guest',
            'Check-in',
            'Check-out',
            'Chargeable nights (full stay)',
            'Rate',
            'Quoted stay total (not payment)',
          ],
        );
        for (const s of stays)
          rows.push([
            s.id,
            s.room,
            s.guest,
            s.check_in,
            s.check_out,
            String(s.nights),
            s.rate,
            s.total,
          ]);
        const orders = await tx.$queryRaw<
          {
            id: string;
            table_name: string | null;
            status: string;
            total: string;
            sale_id: string | null;
            created_at: Date;
          }[]
        >`SELECT o.id,t.name AS table_name,o.status,o.total::text,o.sale_id,o.created_at FROM restaurant_orders o LEFT JOIN dining_tables t ON t.id=o.table_id WHERE (o.created_at AT TIME ZONE ${business.timezone})::date BETWEEN ${q.from}::date AND ${q.to}::date ORDER BY o.created_at`;
        rows.push(
          [],
          [
            'Restaurant order ID',
            'Table',
            'Status',
            'Order total',
            'Receipt sale ID',
            'Created at',
          ],
        );
        for (const o of orders)
          rows.push([
            o.id,
            o.table_name ?? 'Takeaway',
            o.status,
            o.total,
            o.sale_id ?? '',
            o.created_at.toISOString(),
          ]);
        await tx.auditEvent.create({
          data: {
            id: randomUUID(),
            tenantId: a.tenantId,
            businessId: a.businessId,
            branchId: a.branchId,
            actorId: a.userId,
            action: 'report.exported',
            entityId: a.businessId,
            reason: `${q.from} to ${q.to}`,
            requestId: a.requestId,
          },
        });
        return rows.map((row) => row.map(safeCsv).join(',')).join('\r\n');
      },
      'RepeatableRead',
    );
    return res.type('text/csv').attachment('mybusiness-sales.csv').send(csv);
  }
}
@Module({ controllers: [ApiController] })
class AppModule {}
export async function createApplication() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: ['error', 'warn'],
  });
  const express = (await import('express')).default;
  app.use('/api/auth', toNodeHandler(auth));
  app.use(express.json({ limit: '1mb' }));
  app.use((error: unknown, _req: Request, res: Response, next: (error?: unknown) => void) => {
    if (error instanceof SyntaxError) {
      res.status(400).json({
        code: 'INVALID_JSON',
        message: 'The request body is not valid JSON.',
        requestId: randomUUID(),
      });
      return;
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      error.type === 'entity.too.large'
    ) {
      res.status(413).json({
        code: 'REQUEST_TOO_LARGE',
        message: 'This request exceeds the supported size.',
        requestId: randomUUID(),
      });
      return;
    }
    next(error);
  });
  app.use((_req: Request, res: Response, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const webOrigins = [
    process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    ...(process.env.NODE_ENV === 'production'
      ? []
      : [
          'http://localhost:3000',
          'http://127.0.0.1:3000',
          ...(process.env.LAN_ORIGIN ? [process.env.LAN_ORIGIN] : []),
        ]),
  ];
  app.enableCors({
    origin: webOrigins,
    credentials: true,
    allowedHeaders: [
      'content-type',
      'x-tenant-id',
      'x-business-id',
      'x-branch-id',
      'idempotency-key',
      'authorization',
      'cookie',
    ],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  });
  // Cookie authenticated domain writes require the configured web origin. Native requests use the Expo origin protocol.
  app.use((req: Request, res: Response, next: () => void) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.path.startsWith('/api/v1') &&
      req.headers.cookie &&
      ![...webOrigins, 'mybusiness://'].includes(req.headers.origin ?? '')
    ) {
      res.status(403).json({
        code: 'ORIGIN_REJECTED',
        message: 'Request origin rejected.',
        requestId: randomUUID(),
      });
      return;
    }
    next();
  });
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('MyBusiness API')
      .setVersion('1.0')
      .addCookieAuth('better-auth.session_token')
      .build(),
  );
  attachContracts(document);
  SwaggerModule.setup('api/docs', app, document);
  return app;
}
export async function start(): Promise<void> {
  const app = await createApplication();
  await app.listen(Number(process.env.API_PORT ?? 4000), process.env.API_HOST ?? '127.0.0.1');
  console.log('MyBusiness API ready on configured API_PORT');
}
if (!process.env.API_NO_START) void start();
