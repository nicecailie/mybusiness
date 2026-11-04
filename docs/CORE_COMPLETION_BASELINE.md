# Core completion baseline — 4 November 2026

Source: uploaded archive (archive revision 2a8821e), imported into the initially README-only Git checkout. This document records the source before feature changes.

## Existing architecture

TypeScript modular monolith: NestJS controller in `apps/api/src/main.ts`, business services beside it; shared Zod contracts and domain helpers in `packages`; Next.js web workspace; Expo mobile; PostgreSQL with Prisma and checksum-verified SQL migrations. No supplier/purchase/expense/invoice models exist. The corresponding web pages are availability placeholders. Documentation is aspirational where it mentions the complete platform.

Authentication uses Better Auth database sessions and MFA for privileged production roles. Requests select tenant/business/branch via headers; `scoped` rechecks and locks active membership and replaces the caller's role, then sets transaction-local PostgreSQL RLS scope. `write` adds actor/scoped idempotency with payload fingerprints, advisory locks and atomic results. `audit` records actor, request, entity, reason and outbox event. New operations must use these facilities. Business and industry module availability is independently checked on the server.

## Models and behavior

Tenant, Business, Branch, Membership; Product, StockBalance, StockMovement; Customer; CashSession; Sale/SaleLine, Return/ReturnLine, Payment; Journal/JournalLine, Period; AuditEvent, OutboxEvent, Idempotency; OfflineDevice, StockDiscrepancy, ReconciliationEvent; BusinessDocument; DiningTable, RestaurantOrder; Room, Stay.

Inventory has three-decimal quantities and whole BIF values. `allocatedCost` proportionally allocates recorded inventory value (moving weighted average), rounding to whole BIF; the final unit exhausts remaining value. Catalog adjustments, sales, returns and offline reconciliation use shared per-branch/product advisory locks. Opening/increase adjustments currently credit opening equity; they are not purchasing. Offline negative stock has an explicitly unresolved valuation policy; valued receipts must not conceal that shortage.

Sales, payments, stock, receipt, journal, audit and outbox commit together. Cash sessions require the actor's own open register. Noncash payment evidence is explicitly unverified. Returns allocate historical sale cost; only restockable goods restore inventory. Journals use named account codes: 1000 Cash, 1200 Inventory, 3000 Opening equity, 4000 Sales, 5000 Cost of sales, 5100 Damaged goods. Database triggers enforce balanced immutable postings and closed periods. There is no general chart-of-accounts configuration. Existing gross profit is not net profit; reports currently omit operating expenses and receivables/payables.

## Routes and pages

Existing API groups: contexts, onboarding/activation, products, stock/opening, stock/movements, customers, cash-session, sales/receipts/returns, dashboard, journals, audit, reports exports, offline, reconciliation, business/documents, staff, restaurant/tables/orders/pay, accommodation/rooms/stays. All are in main.ts with service-level authorization.

Web workspace pages: overview, reports, products, customers, sales, sell, accounting, team, settings; purchases/invoices/expenses placeholders. UI uses shared panels, tables, forms, query keys partitioned by business/branch. Industry-specific restaurant/accommodation panels sit on overview. Mobile has existing operations/offline queue, not all desktop modules.

## Permissions before changes

Owner/manager: business.manage, catalog.read/write, stock.receive, sale.create/read/refund, cash.manage, customer.read/write, report.read, journal.read.
Cashier: catalog.read, sale.create/read, cash.manage, customer.read/write.
Inventory: catalog.read/write, stock.receive.
Accountant: catalog.read, sale.read/refund, customer.read, report.read, journal.read.
Viewer: catalog.read, sale.read, report.read.

Staff list/create exists via guarded SQL routines; edit/reactivation, branch reassignment and invitations are missing. Roles are constrained in SQL and duplicated in API/client contracts. Catalog costs are hidden from cashiers but report access is broader than granular finance permissions. Backend enforcement must not depend on menu visibility.

## Missing/partial

Suppliers, PO lifecycle, receipts, supplier liabilities/payments, operating expenses, credit invoices/payments, receivables, transfers and stocktakes are absent. Financial statements and role-focused dashboards are partial. Restaurant order payment reuses POS; accommodation stays track booking amounts but do not create settlement journals. Do not represent stay bookings as recognized revenue. Advanced industry workflows remain deferred.

## Baseline checks

Available: domain/offline tests (`pnpm test`), database integration, review database suite, HTTP/MFA/review HTTP suites, formatter, lint, boundaries, full TypeScript check, Next production build and optional Expo export. Baseline execution is pending locked dependency installation and isolated PostgreSQL preparation; results will be recorded in the implementation report. No assertion of passing baseline tests is made here.

## Baseline execution result

After installing locked dependencies and creating an isolated PostgreSQL cluster, the untouched application passed all 9 domain/offline tests and all 11 integration tests before major feature changes. New-feature results and remaining limitations are in CORE_COMPLETION_IMPLEMENTATION_REPORT.md.
