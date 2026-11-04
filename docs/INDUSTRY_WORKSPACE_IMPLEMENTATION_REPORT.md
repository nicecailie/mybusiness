# Industry workspace implementation checkpoint

Date: 4 November 2026. Baseline: commit `0d441331dbcebfd939fe000f3c6a994a94862151`, clean working tree at the start of this request. See INDUSTRY_WORKSPACE_BASELINE.md for the source-derived 25-industry inventory and 15 retail-capability classifications.

## Checkpoint and scope

**Phase A completed at this checkpoint. Phases B, C and D were not started.** This is not completion of the whole industry-workspace request. The stop is at a tested shared-core boundary: starting variants/batches, kitchen/recipe stock or hotel deposits without completing their schema, offline/return, financial and role invariants would create unsafe partial workflows. The user explicitly permits finishing the current phase and documenting the stop when the task budget is exhausted.

No specialist placeholder pages or extra module flags were enabled to imply unfinished features work. Existing retail/POS/offline/returns, restaurant order payment, accommodation stays and expert reports are retained. In particular, **the existing stay-to-finance gap remains unresolved until D**; do not claim hotel revenue now appears in Money merely because accommodation is a configured module.

## What was reused

Existing Supplier → PurchaseOrder/Lines → GoodsReceipt/Lines → SupplierBill → FinancePayment records; shared stock balances/movements and weighted-average costing; exact BIF helpers; scoped/write, membership locks, RLS, audit/outbox and balanced immutable journals; existing category/expense/invoice/report endpoints; current industry catalog and web panel/button/table vocabulary.

Transaction bodies for saveSupplier, savePurchase, receivePurchase, createBill and settle were extracted into reusable transaction helpers in core.ts. The legacy wrappers retain permissions, operation names, input fingerprints and results. financialReport now delegates to the same in-transaction implementation reused by Money; it remains the authoritative sales/profit source. No competing inventory, sale, payment or ledger tables were added.

## What is new in A

### One-screen purchasing

- One Purchases list with supplier/items/total, Ordered?, Received and Paid columns, next actions, search/pagination, same-screen supplier balances and a history drawer. Phone layout stacks the status columns into usable cards.
- One form with existing supplier or inline new supplier, product/quantity/cost rows, Save as order and Save draft. Inline supplier and purchase commit atomically; a failed item validation does not leave a stray supplier.
- A Receive box prefilled with every pending line. Actual quantities can be edited, including omitting a line by receiving zero. It reuses receiving/costing, then automatically creates any missing valued receipt-backed bill and the existing inventory/clearing/AP journals **inside the same transaction**.
- Mark paid defaults to the full amount still owed for received items, supports partial amount and cash/bank, and allocates existing bills using the same settlement helper. No payment can exceed the current received/billed balance. Same-key double-click/network retries return one effect; purchase/bill locks serialize legacy payment paths too.
- Receiving/paying a legacy received-but-unbilled purchase safely creates its missing bill. Supplier owed includes that received-but-unbilled value, so row and Money balances do not silently drop old liabilities.
- Supplier owed, bills and payment history are withheld from inventory/purchasing roles without existing finance authority. Inventory can create the system's receipt/bill postings through receiving but gains no payment or finance-read grant. Cashiers are denied directly by APIs.
- Payment status is explicitly for received items. Prepayment before receipt is not added. Zero-incremental-value fractional receipts remain quantity-auditable without a zero-value bill/journal.
- Ordinary navigation has no Bills, Receipts or Payables pages. Existing expert CorePanel/legacy endpoints remain under More options for finance users.

### Costs and Money

- ExpenseCategory.kind = running/equipment/other, optional systemKey for translated default categories, and defaults for current/future businesses. Existing custom category classifications are preserved; owners should review old categories before production use.
- Expense.postingAccount snapshots its original debit account. Running = 6000; Equipment = 1500 asset; Other = 6100 cost. Equipment never reduces ordinary running-cost profit; its reversal uses the recorded account even if category metadata later changes. Existing expense rows keep their original 6000 posting basis.
- A plain Costs screen uses the existing categories/expense/reversal endpoints and actual kind labels. Stock deliveries belong in Purchases; posted costs are corrected by reasoned Undo/re-entry, not overwritten.
- Money reuses journal-based financialReport, with sales, cost of goods, profit on sales, running costs, stock losses/gains, profit after costs, current customer/supplier owed and stock value. Supplier owed includes both AP and received-but-unbilled journal balances.
- Cash in/out comes from actual 1000 Cash journal debit/credit totals for the selected dates, clearly separated from sales/profit/current balances and explicitly excluding bank payments. These are business-cash movements, not a bank balance or a POS drawer count.
- One All spending list derives purchase/cost/equipment/other rows and reversals from the same journals and links back to the original purchase/cost. It does not expense stock purchases or count a supplier payment as a second purchase.
- Product and category profit and margin are computed on the server from existing sales/invoice/return sources. Stock valuation/detail is server-supplied. Frontend uses BigInt formatting, not financial calculations.

### Workspaces and compatibility

- workspaceLinks in industries.ts filters actual direct links by the catalog's configured/effective modules and role grants. A small IndustryHome reuses the allowed links and permission-gated operational or Money facts. No widget framework or specialist route stubs.
- Shared base/service industries now include their already-implemented invoicing module; no variants/batches/kitchen/reservation gate was turned on.
- Cashier: sale/receipts/register; inventory: products/stock/receiving; purchasing: purchases/suppliers; accountant: costs/Money and expert records; owner/manager summaries and existing allowed actions. Server scopes still enforce each API independently from these links.
- Industry terminology comes from the existing bilingual catalog. New Phase A labels/statuses/forms are in the shared en/fr message dictionary. A browser-discovered mount race overwriting saved locale was fixed, and French persists after refresh.
- Verified onboarding retains requested industryId and branch context; strict business-update input continues to reject industry changes, with a settings warning protecting existing transactions. No historical conversion route was introduced.
- pnpm dev/dev:lan use package-name filters, addressing the reported Windows directory-filter mismatch. HTTP runner launches the installed tsx CLI through Node for Windows portability while retaining real authentication-rate isolation. Browser smoke accepts an executable override or system/Playwright Chromium. Native Windows execution was not performed in this Linux environment.

## New endpoints (legacy endpoints retained)

| Method/path                         | Permission and behavior                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| GET /api/v1/purchasing              | purchase.read; scoped row/status/quantity/history view; financial fields further restricted       |
| POST /api/v1/purchasing             | purchase.create; requires supplier.create for inline supplier, purchase.approve for Save as order |
| POST /api/v1/purchasing/:id/update  | same permissions; draft-only reuse of savePurchase                                                |
| POST /api/v1/purchasing/:id/receive | purchase.receive; atomic receive + automatic missing bills                                        |
| POST /api/v1/purchasing/:id/pay     | payable.manage; current bill balances, full/partial allocation, journal/audit                     |
| GET /api/v1/money                   | finance.read; same RLS/membership/industry boundaries and bounded date contract                   |

All mutations use POST, validation, write idempotency and audit. No CORS method broadening. OpenAPI publishes the new purchase command schemas. Existing default-only category command retries preserve their pre-upgrade payload fingerprint.

## Database migrations

| Migration                                                      | Changes                                                                                                                                                                | Safety                                                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| prisma/migrations/202611040005_spending_kinds/migration.sql    | category kind/system_key + checks/partial unique key; expense posting_account snapshot + allowlist; defaults for existing businesses                                   | Additive, existing journal/expense meanings remain; no data reset, table or column deletion |
| prisma/migrations/202611040006_spending_defaults/migration.sql | AFTER INSERT business trigger creates reference categories for future businesses; fixed-search-path SECURITY DEFINER function, PUBLIC/runtime direct execution revoked | Additive; no new grants on business data, no replacement RLS policies                       |

Existing 16 migration files are untouched. No new sales/inventory/payments tables. Existing memberships and seven role templates remain; no waiter/kitchen/receptionist/housekeeping role or permission constraint changes occurred in A.

## Accounting assumptions needing business approval

| Assumption                                                | Current status                                                                                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Equipment is an asset, with no depreciation               | Implemented A: 1500 Equipment. Review classification/policy before production. No retroactive reclassification of past expense journals.                                                         |
| Restaurant stock changes at payment                       | Existing behavior preserved; Phase C must retain/extend it atomically for recipes.                                                                                                               |
| Hotel revenue at checkout and deposits held until billing | **Not implemented**; proposed Phase D policy needs approval. Existing stay creation still posts nothing.                                                                                         |
| VAT                                                       | Not configured/added. No invented rate; Phase B must establish reviewed rate, receipt and journal treatment.                                                                                     |
| Posting dates / cash                                      | Existing posting-date model preserved. Costs/bills/invoice issuance use today's business date. Cash view is recorded business-cash movement, not proof of provider settlement or drawer balance. |

## Limitations and exact stop

Next phase is **B: variants, optional batch/expiry/FEFO, expired-sale blocking, supplier-linked reorder and VAT policy review**. Product/category profit visibility has been exposed from existing reports, but B is not otherwise implemented. C waiter/kitchen/lifecycle/recipes and D stay finance/deposits/checkout/cleaning/room-charge linkage are wholly pending. The manual checklist labels their desired scenarios blocked instead of claiming they passed.

Other industries' advanced features, bar tabs, serving-unit recipes, advanced fast-food modes, rate plans, folio splitting, depreciation, custom dashboard editors, guided tours, fully localized legacy expert panels, large-history pagination/exports, native-device/hardware QA and production deployment are deferred. This phase localizes its new normal-worker screens; existing expert/legacy panels retain prior copy and capabilities.

Source lists/date filters are real, not mocked. Some legacy pickers are bounded to 100 products and historical Money queries currently load source rows in-process; large-data pagination/query tuning remains required. Default categories are added without renaming/reclassifying existing custom categories, so an old custom category named Equipment should be reviewed for its intended kind. Received goods, not unreceived PO totals, determine the amount available to pay.

## Checkpoint validation

Baseline pnpm check passed before feature edits (9 domain/offline tests, API/web/mobile typechecks, lint and boundaries). During development, initial browser/type issues (a Next module-extension import, persisted-locale race, missing required payment account in test input, asynchronous UI refresh assertion) were diagnosed and corrected; no assertion was disabled or replaced with a trivial passing check.

| Command                             | Outcome                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline pnpm check                 | Passed before feature changes: typechecks/lint/boundaries + 9 tests                                                                                                                                                                                                                                            |
| pnpm db:generate                    | Passed for the additive schema using the installed package’s bundled schema path; no checksum/TLS verification disabled                                                                                                                                                                                        |
| pnpm db:migrate                     | Applied 202611040005 and 202611040006 to the isolated development database; existing migrations unchanged                                                                                                                                                                                                      |
| pnpm check                          | Passed: API/shared/web/mobile typechecks, lint, boundary check and 9 domain/offline tests                                                                                                                                                                                                                      |
| pnpm test:integration               | **46 passed**: all 35 previous tests + 11 new Phase A tests, no skipped/disabled tests                                                                                                                                                                                                                         |
| pnpm test:review                    | **6 passed**, including original restaurant/accommodation/offline/document/team behavior                                                                                                                                                                                                                       |
| pnpm test:http                      | **4 passed**, including original auth/MFA/offline contracts and new purchase/auto-bill/payment assertions; real rate limiter retained                                                                                                                                                                          |
| pnpm build                          | Passed: Webpack compilation, TypeScript, static generation and tracing                                                                                                                                                                                                                                         |
| node scripts/core-browser-smoke.mjs | Passed: inline purchase/order, partial/full receive with auto-bill, partial/full pay, populated en/fr refresh, equipment cost/Money, existing invoice partial payment, original expert branch/previous-period reports, 390px phone overflow, cashier direct-page denial and inventory finance-button exclusion |
| pnpm format:check                   | Final formatting outcome verified after documentation generation                                                                                                                                                                                                                                               |
| git diff --check                    | Passed                                                                                                                                                                                                                                                                                                         |

**65 automated tests passed** (9 + 46 + 6 + 4), plus real browser scenarios and production build. Human/native-device scenarios and B/C/D acceptance tests are not claimed as executed or passed. PostgreSQL is the retained isolated local development instance; no production data was reset. The build check was repeated after the explicit stock-loss figure needed to reconcile profit was added.

For an existing local installation, retain your .env and Docker database volume. Refresh dependencies, run pnpm db:generate and pnpm db:migrate, then pnpm dev. No database reset/reseed is required for these additive changes. Node >=24 is still required. Git publication, if performed, is identified in the final chat response; production deployment is separate.

See INDUSTRY_WORKSPACE_FILE_CHANGES.md for Created/Modified/Migrations/Tests/High-risk inventory and INDUSTRY_WORKSPACE_MANUAL_CHECKLIST.md for short real/blocked scenarios. No live provider delivery or production deployment was performed. The requested specialist-worker definition of done is not met until B–D are completed.
