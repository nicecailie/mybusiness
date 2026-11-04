# Industry workspace implementation report

Updated 4 November 2026. Phase A was delivered in `273027b`. This continuation implements B (retail variants/expiry), C (restaurant kitchen/recipes) and D (hotel checkout/deposits). The original ZIP/Core Completion inventory remains historical; this continuation is measured against the clean Phase A commit.

## Retail (B)

- The quick grid accepts attribute, SKU/barcode, price, opening quantity/cost and optional expiry. Variants are child Product rows with stable IDs, free-text attributes, independent SKU/barcode/price and shared StockBalance/StockMovement quantities and weighted-average costs. The original product and its history remain intact. POS selects a child in one tap; signed offline replay uses the same child ID.
- Batch tracking is optional and selected at creation. Receiving/opening stock requires an expiry date. Branch-scoped lot quantities allocate FEFO; online POS and invoices cannot consume expired lots. Expired quantities remain visible for writeoff rather than disappearing from inventory value. Transfers carry lot expiries into the destination; stock counts and adjustments use the common movement primitive.
- Sale lines capture the actual ingredient/product quantities, costs and lot allocations. Returns restore those snapshots, including the original expiry, rather than using today's recipe or cost. Non-batch products retain the original shortage/offline policy.
- Low-stock Reorder opens the shared purchase form with the latest branch purchase's supplier/unit cost and a suggested quantity up to twice the minimum stock level. Missing supplier/history remains an explicit user choice. Money retains product/category performance.
- VAT was missing. It is an optional per-product rate (0–100%, basis points), zero by default, included in the displayed price. Whole-BIF tax is rounded per line, snapshotted and posted to `2200 VAT payable`; refunds reverse cumulative original tax. Money product profit excludes VAT. Offline prices and VAT come from the signed catalog proof, with old proofs interpreted as zero VAT.

## Restaurant / fast food (C)

- `New → Preparing → Ready → Served → Paid`, plus cancellation before settlement. Counter orders can go directly New → Ready. Old unpaid orders migrate to Served; old paid records remain paid.
- Waiters select a table/counter, tap menu items and send, or append items to an open order. Append resets preparation status; cancellation consumes no stock.
- Kitchen has a separate polling queue and Start/Ready buttons. Its API explicitly selects item names, quantities, kind and preparation data; it never serializes price/cost/payment fields.
- Cashiers pay Ready/Served orders through the existing order advisory lock, price-change guard and `postSale`. Concurrent retries return the same sale.
- Optional recipes belong to service menu items; direct goods use their own stock. Payment captures and consumes ingredient quantities inside the sale transaction, with one COGS/revenue posting. Returns use the captured ingredient quantities/costs after recipe edits. Fractional quantities that cannot represent ingredient thousandths are rejected instead of rounded silently.
- Added waiter/kitchen permissions and staff templates. Waiters have no suppliers, finance or team access; kitchen has no catalog or payment access. Backend membership revalidation and module checks remain authoritative.

## Hotel / guest house (D)

- Room cards show Available, Reserved, In use, Needs cleaning, Cleaning and Under repair. Reservations capture guest, dates, guest count and the agreed nightly rate. Room advisory locks and a database trigger reject overlapping active stays; cancelled/no-show dates are released.
- Check-in changes the stay to In use. Checkout creates and issues an existing Invoice, applies deposits using FinancePayment, optionally takes a full/partial cash/bank payment, and sets the room to Needs cleaning. Unpaid balances remain accounts receivable and can be collected from the stay screen. Stay history and a guest bill retain extras, deposits and linked charges.
- Housekeeping has a dedicated price-free room list and Start/Done actions. Under-repair changes require business management permission. Receptionists use stay-specific billing permissions and cannot access general finance, supplier, team or invoice endpoints.
- Internal service products satisfy InvoiceLine.productId for nights, extras and restaurant-charge clearing. They are hidden from normal catalog/POS and rejected by public invoice creation.
- A restaurant order charged to an occupied room uses `postSale` once, deducting stock and posting restaurant revenue/COGS without inventing a cash payment. It debits `1400 Guest room charges`. Checkout debits invoice AR and credits that clearing asset for the linked restaurant charge; it does not create another restaurant sale, stock deduction, VAT liability or revenue entry.

## Accounting policies and practical limits

| Policy               | Behavior                                                                                                                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Room revenue         | Recognized at checkout at the captured rate for all booked nights; no automatic nightly accrual or early-departure proration.                                                                                                                                                                      |
| Restaurant revenue   | Recognized when paid or charged to an occupied room after preparation. Guest invoice clearing is not a second sale.                                                                                                                                                                                |
| Deposits             | Dr cash/bank, Cr `2300 Guest deposits` on receipt. Applied at checkout: Dr deposits, Cr AR through FinancePayment, without another cash movement. Cancellation/no-show refunds held amounts to their original accounts; no automatic forfeiture. Deposits are capped at the agreed room charge.    |
| Hotel cash           | FinancePayment cash/bank is business cash, separate from actor POS drawer payments. No fictitious register session or cash receipt is generated for a room charge.                                                                                                                                 |
| VAT                  | Inclusive, optional product rate; no default legal rate, automatic tax registration, hotel-tax assumption or tax-return filing. Hotel services default to zero VAT and require a business-reviewed policy before changing tax treatment.                                                           |
| Valuation            | One moving weighted-average StockBalance remains authoritative. Lots track quantity/expiry, not a second cost ledger.                                                                                                                                                                              |
| Expiry and offline   | Expiry-tracked products require online checkout, including mobile, so current lots can be checked. Ordinary products and variants retain signed offline replay.                                                                                                                                    |
| Recipes and invoices | Recipe items use restaurant/POS settlement, not independent credit invoices, to preserve the captured consumption/return path.                                                                                                                                                                     |
| Legacy stays         | Marked legacy/unbilled; no backdated invoices, deposits or revenue are invented by migration. Review historical stays before operational checkout.                                                                                                                                                 |
| Credits              | Settled room-charge returns require a reviewed guest credit workflow; generic POS cash refunds reject room charges. Automatic guest credit notes, room discounts/proration, deposit forfeiture, depreciation, bar tabs and advanced serving-unit/fast-food features remain outside this increment. |

## Database and rollout

Apply `202611040007_retail_stock`, `008_hospitality_workflows`, `009_hotel_accounting` and `010_hotel_update_grants` with the migration-owner connection, then generate the Prisma client. These are forward migrations: no table/data deletion or reset, no mutation of earlier checksummed migrations. They add scoped tables/columns, update old unpaid statuses, extend role constraints/routines, replace the sale/payment amount checks for explicit room settlement, and grant only hotel workflow update columns. Existing forced RLS is preserved; new lot/deposit tables have forced tenant/business/branch RLS. Guest deposits are insert-only for the runtime role.

Local/Windows update from the repository root:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd db:generate
pnpm.cmd db:migrate
pnpm.cmd db:seed
pnpm.cmd dev
```

Use Node 24 or newer and the existing `.env`/PostgreSQL setup. Open http://localhost:3000. Existing production databases should be backed up through their normal operations process before applying migrations; demo seeding remains explicitly restricted to demo environments.

The seed adds fictional `restaurant-owner@example.test`, `hotel-owner@example.test`, `waiter@example.test`, `kitchen@example.test`, `restaurant-cashier@example.test`, `receptionist@example.test` and `housekeeping@example.test`. They use the ignored `.env` DEMO_PASSWORD. Original owner contexts and existing demo data remain unchanged.

## Verification

| Check                                        | Result                                                                                                                                                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                 | Passed: root/web/mobile types, ESLint, 46-module import boundaries and 9 domain/offline-queue tests.                                                                                                                                                  |
| `pnpm test:integration`                      | Passed: 57 database tests (including 11 new B–D scenarios).                                                                                                                                                                                           |
| `pnpm test:review`                           | Passed: 6 existing review regressions.                                                                                                                                                                                                                |
| `pnpm test:http`                             | Passed: all 5 real-session HTTP suites, including waiter/kitchen/reception/housekeeping.                                                                                                                                                              |
| `pnpm build`                                 | Passed: production web compilation, types and page generation.                                                                                                                                                                                        |
| `node scripts/hospitality-browser-smoke.mjs` | Passed: variant opening quantity/cost, supplier/product/quantity reorder prefill, expiry home alerts, booking/deposit/partial checkout and named extras, housekeeping, kitchen/payment, French persistence, 390px layout and restricted worker views. |
| `node scripts/core-browser-smoke.mjs`        | Passed: existing purchase/receipt/payment, Money/equipment, invoice/payment, refresh, French, phone and role-denial flows.                                                                                                                            |
| `pnpm format:check`, `git diff --check`      | Passed.                                                                                                                                                                                                                                               |

Total across the requested test suites: **77 tests passed**, none skipped or disabled. The final itemized guest-bill change was additionally checked with all 11 B–D database scenarios and the browser flow. Browser checks use local Chromium and phone/tablet viewports, not a physical Windows or native mobile device. The generated Prisma client matches the current schema/installed version. SQL migrations were applied to the local development database; no production deployment was performed.

An earlier HTTP run was interrupted by the API development watcher restarting during an edit. The complete rerun against stable source passed. Browser checks also exposed asynchronous product-option loading in the test: the assertion now waits for the controlled select to receive its options rather than checking before the catalog response.

See [file inventory](INDUSTRY_WORKSPACE_FILE_CHANGES.md), [manual scenarios](INDUSTRY_WORKSPACE_MANUAL_CHECKLIST.md) and [historical baseline](INDUSTRY_WORKSPACE_BASELINE.md).
