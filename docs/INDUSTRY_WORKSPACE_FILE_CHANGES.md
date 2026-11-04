# Industry workspace file changes — Phase A checkpoint

Baseline: Git commit 0d441331dbcebfd939fe000f3c6a994a94862151. The tree was clean at the start of this request, so this is a useful implementation baseline. Unlike the earlier original-ZIP import audit, unchanged ZIP-origin application files are already committed and are not counted as created here.

Scope: Phase A implemented; B/C/D not started. See INDUSTRY_WORKSPACE_IMPLEMENTATION_REPORT.md for actual completion, accounting assumptions and remaining work. Paths below are relative to the repository root.

## Created

| Exact path                                                       | Purpose                                                                                                                                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/money.ts`                                          | Journal-derived Money metrics, distinct cash in/out, current owed balances, source-linked spending, inventory and product/category profit views.                                        |
| `apps/api/src/purchasing.ts`                                     | Atomic inline supplier/order, receive+auto-bill and order-wide payment commands; scoped purchase/supplier balances and traceable histories. Reuses extracted core transaction helpers.  |
| `apps/web/app/industry-home.tsx`                                 | Small role/industry-filtered home card list and actual authorized Money/operational facts.                                                                                              |
| `apps/web/app/money-workspace.tsx`                               | Plain Money and Costs screens; category-kind labels, journal-backed cards/source rows, equipment separation and audited undo using existing endpoints.                                  |
| `apps/web/app/purchasing-workspace.tsx`                          | Single purchase screen with inline supplier, order/draft form, multi-line receiving, full/partial payment, status columns, supplier totals and history; responsive English/French copy. |
| `docs/INDUSTRY_WORKSPACE_BASELINE.md`                            | Pre-change 25-industry inventory, 15 retail classifications, source gaps and dependency plan.                                                                                           |
| `docs/INDUSTRY_WORKSPACE_FILE_CHANGES.md`                        | This Git-baselined created/modified/migration/test/risk inventory.                                                                                                                      |
| `docs/INDUSTRY_WORKSPACE_IMPLEMENTATION_REPORT.md`               | Phase A scope/stop, reused paths, endpoints, migrations, accounting assumptions, limitations and checkpoint outcomes.                                                                   |
| `docs/INDUSTRY_WORKSPACE_MANUAL_CHECKLIST.md`                    | Short A real workflows plus explicitly blocked B/C/D desired scenarios, roles, French/mobile and financial checks.                                                                      |
| `prisma/migrations/202611040005_spending_kinds/migration.sql`    | Adds category kind/system key, expense posting-account snapshot, constraints/index and defaults for existing businesses.                                                                |
| `prisma/migrations/202611040006_spending_defaults/migration.sql` | Adds guarded business-insert trigger for future default categories; no data/RLS deletion.                                                                                               |
| `tests/industry-workspace.test.ts`                               | 11 integration tests for atomic purchase/auto-bill/pay, equipment/cash/profit, RLS/roles, onboarding/catalog, legacy unbilled purchases and pre-upgrade idempotency.                    |

## Modified

| Exact path                          | Change                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/core.ts`              | Extracts reusable supplier/purchase/receipt/bill/payment and report transaction bodies without changing legacy wrapper operation names; category-kind posting and reversal snapshots; category-level profit labels; preserves default-only category retry fingerprints. |
| `apps/api/src/main.ts`              | Adds authenticated/scoped purchasing entry/read/update/receive/pay and Money routes with validated IDs/date ranges and existing filters.                                                                                                                                |
| `apps/api/src/openapi.ts`           | Publishes canonical contracts for the new combined purchase actions.                                                                                                                                                                                                    |
| `apps/web/app/client.tsx`           | Catalog/role-selected navigation, Money/Stock direct links and expert More; money/stock deep links; saved-language mount persistence fix.                                                                                                                               |
| `apps/web/app/styles.css`           | Existing panel vocabulary extended for compact metric cards, form fieldsets and stacked phone purchase status rows.                                                                                                                                                     |
| `apps/web/app/ui.tsx`               | Adds money and stock to existing Page type.                                                                                                                                                                                                                             |
| `apps/web/app/workspace.tsx`        | Routes normal purchasing/costs/Money/home to new shared panels; preserves stock/invoices and expert reports, direct access guards and industry-change warning.                                                                                                          |
| `docs/INDUSTRIES.md`                | Corrects stale restaurant/accommodation claims and reports implemented/partial/deferred status for all 25 industry IDs.                                                                                                                                                 |
| `package.json`                      | Package-name development filters for Windows and integration-suite registration; dependency versions unchanged.                                                                                                                                                         |
| `packages/contracts/src/core.ts`    | Validated combined purchase-entry/payment commands and backward-compatible default category kind.                                                                                                                                                                       |
| `packages/domain/src/industries.ts` | Actual role/module link selection; shared/service invoicing module enabled because its implementation already exists; no specialist placeholder gates.                                                                                                                  |
| `packages/i18n/src/index.ts`        | Shared en/fr labels for all new Phase A forms, statuses, navigation, Money and Costs; no new client runtime import path.                                                                                                                                                |
| `prisma/schema.prisma`              | Adds ExpenseCategory kind/systemKey and Expense postingAccount; no new sales/inventory/ledger model.                                                                                                                                                                    |
| `scripts/core-browser-smoke.mjs`    | Updates normal purchasing/expense scenarios for one-screen flow and auto-bills; adds populated French persistence checks; retains invoice, expert branch/period, phone and role checks; portable Chromium selection.                                                    |
| `scripts/test-http.mjs`             | Launches installed tsx CLI with Node rather than a platform-dependent pnpm executable; preserves rate-window pacing and test exit status.                                                                                                                               |
| `tests/core-completion.test.ts`     | Uses a unique Rent fixture name because defaults now exist for new businesses. Original business assertions retained.                                                                                                                                                   |
| `tests/core-http.test.ts`           | Adds new endpoint denials and real HTTP purchase→receive/auto-bill→part/full payment and retry assertions; no original assertions disabled.                                                                                                                             |

## Deleted / replaced

No previously committed file was deleted. No existing migration was rewritten. The original English legacy core panels remain for invoices, stock and expert finance operations; the ordinary purchasing/costs route chooses the simpler panels. Transaction-body extraction reuses the existing core rather than replacing stock/accounting systems. A temporary uncommitted translation module was folded into the existing i18n registry during implementation and is not a deleted baseline file.

## Migrations

- `prisma/migrations/202611040005_spending_kinds/migration.sql`: additive category/expense fields, constrained kinds/posting accounts, scoped system-key index, defaults for existing businesses. All historical expense accounts default to their prior 6000 account; existing journal rows are not changed.
- `prisma/migrations/202611040006_spending_defaults/migration.sql`: additive default-category function/trigger for new businesses, fixed search path, no PUBLIC/runtime direct execute. No new role grants or RLS policy replacement. Review SECURITY DEFINER and preservation of actor/business ownership carefully.

Both migrations applied to the isolated demo database. They add no new inventory, sales, finance-payment or journal tables and do not destroy data. Production migration lock/downtime testing is separate.

## Tests

- `tests/industry-workspace.test.ts`: 11 new database tests, including simultaneous same-key commands, accurate AP/stock/cash, equipment snapshots/reversal, caller role refresh, scoped industry/branch denies, category defaults, onboarding storage, legacy receipt handling and pre-upgrade retry compatibility.
- `tests/core-http.test.ts`: existing authenticated suite extended for the new APIs/denials and one-screen action lifecycle.
- `tests/core-completion.test.ts`: only fixture-name adjustment for seeded defaults; no assertion removal.
- `scripts/core-browser-smoke.mjs`: real one-screen purchasing and automatic bills, Money/equipment, English/French refresh, original invoice/partial payment, original expert branch/previous-period reports, phone overflow and cashier/inventory restrictions.
- `scripts/test-http.mjs`: serial real HTTP/MFA/offline tests with real auth throttling preserved and cross-platform Node invocation.

Existing domain/offline, integration, restaurant/accommodation review and MFA suites remain active. Exact command/count/build results are recorded in INDUSTRY_WORKSPACE_IMPLEMENTATION_REPORT.md; no pending specialist scenario is described as passed.

## High-risk review

| Area                                   | Files and review focus                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization, tenant/branch isolation | `apps/api/src/purchasing.ts`, `apps/api/src/money.ts`, `apps/api/src/main.ts`, `packages/domain/src/industries.ts`: actual scoped membership/role/module checks, financial redaction, source-linked drilldowns and branch-limited owed/history. No authentication provider or membership-role template change. |
| Stock / cost / COGS                    | `apps/api/src/core.ts`, `apps/api/src/purchasing.ts`: helper extraction preserves existing stock movement/valuation path, stable stock locks and cumulative partial-receipt rounding.                                                                                                                          |
| Journals / payments                    | `apps/api/src/core.ts`, `apps/api/src/purchasing.ts`, `apps/api/src/money.ts`: receive+bill atomicity, legacy bill lock compatibility, allocation caps, one financial effect on retry, AP vs unbilled totals, equipment snapshot/reversal and cash/accrual separation.                                         |
| Migrations / reference seed            | `prisma/schema.prisma`, both migration files: financial snapshot defaults, old category preservation, trigger scope, fixed-search-path privileged function.                                                                                                                                                    |
| Frontend / worker simplicity           | Three new workspace components plus `apps/web/app/client.tsx`, `apps/web/app/workspace.tsx`, `packages/i18n/src/index.ts`: one screen, next actions, saved locale, no money calculations, role-specific links, phone layout and retained retry keys.                                                           |
| Startup / tooling                      | `package.json`, `scripts/test-http.mjs`, `scripts/core-browser-smoke.mjs`: package-name pnpm filters, portable process execution, browser availability and real auth-rate windows. Native Windows execution not claimed.                                                                                       |

Unchanged sensitive dependencies: `apps/api/src/database.ts`, `auth.ts`, `sales.ts`, `accounting.ts`, `catalog.ts`, `restaurant.ts`, `business.ts`, `onboarding.ts`, old RLS migrations and offline logic. The new services reuse their security/transaction rules. No credential file, database state, node_modules/cache or generated Next/Prisma output is part of this source inventory.

## Counts

**12 files created, 17 files modified, 0 baseline files deleted.** This includes all four new requested workspace documents and this inventory itself. The two migrations and new test are included in the created count, not counted again. Unchanged original application files are excluded.
