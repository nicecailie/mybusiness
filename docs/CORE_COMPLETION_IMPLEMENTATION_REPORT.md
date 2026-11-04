# Core completion implementation report

Date: 4 November 2026. Source: uploaded MyBusiness archive, imported into the existing README-only checkout. No new worktree or rewrite was created. This is a substantial shared-core increment, **not completion of every requested phase or a production certification**.

## 1. What was implemented

- Business-scoped supplier create/list/search/edit/details/deactivation, branch purchase history and finance-gated bill visibility.
- Branch-scoped purchase orders: draft/create/edit, order, cancellation before receiving, full/partial/multiple receipts, cumulative received/remaining quantities and sequential document numbers.
- Atomic goods receipts use the existing stock balances, stock movements, weighted-average value and stock advisory-lock namespace; receipts cannot overconsume order quantities. Actor, branch, timestamp, value, audit and journal are retained.
- Receipt-backed supplier bills, unique supplier references, one bill per receipt, partial/full supplier payments, immutable payment history and outstanding AP.
- Configurable expense categories, date/category filtering, posting, totals and reasoned reversal. Corrections use reversal plus replacement rather than rewriting posted financial history.
- Customer credit invoices with captured lines, draft/issue, partial/full payments, payment history and print view. Issuing posts AR/revenue/COGS/inventory atomically. Drafts can be voided. Confirmed paid POS sales can be linked without duplicating sale/stock/revenue/payment effects.
- Customer account/history panel and journal-based Financial overview with P&L, cash/bank movement, current AR/AP, current inventory valuation product performance, authorized branch performance and previous comparable periods. Original POS dashboard remains separate from all-source financial totals.
- Branch stock transfers: draft/send/receive/cancel-draft, auditable movements, preserved cost and Inventory in transit postings; double receipt is denied.
- Physical stock counts: expected/counted/variance, explicit adjustments, reviewed positive-variance cost, finalizer audit and stale-count rejection.
- Purchasing role template and granular module permissions; accountant default refund privilege removed. Membership role/deactivate/reactivate controls reuse guarded SQL routines. Existing accounts can gain branch membership through existing staff creation in the selected branch.
- Focused cashier/inventory/purchasing home panels, permission-aware navigation, direct-page access-denied states, page query-string refresh/back/forward and business/branch-partitioned caches.
- New integration, HTTP security and browser acceptance checks. Existing restaurant/accommodation/offline/POS functionality retained and exercised.

## 2. Files changed

The archive supplies the original application files, which are new files relative to the GitHub checkout's one-line README. Feature changes below are relative to that archive:

| Area                  | Files                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema/database       | `prisma/schema.prisma`; additive migrations `202611040001_core_completion` through `202611040004_core_integrity`                                          |
| Backend               | `apps/api/src/core.ts`, `main.ts`, `database.ts`, `openapi.ts`                                                                                            |
| Contracts/permissions | `packages/contracts/src/core.ts`, `index.ts`; `packages/domain/src/index.ts`, `industries.ts`                                                             |
| Frontend              | `apps/web/app/core-panels.tsx`, `workspace.tsx`, `client.tsx`, `review-panels.tsx`, `styles.css`                                                          |
| Reports               | Journal-derived reporting in `core.ts`, rendered by FinancialPanel; existing POS report implementation preserved                                          |
| Tests/checks          | `tests/core-completion.test.ts`, `tests/core-http.test.ts`, `scripts/core-browser-smoke.mjs`, `scripts/test-http.mjs`; package scripts include new suites |
| Environment helpers   | `scripts/cloud-install.sh`, `cloud-start.sh`, `client-current.mjs`                                                                                        |
| Documentation         | This report, `CORE_COMPLETION_BASELINE.md`, `MANUAL_VERIFICATION_CHECKLIST.md`                                                                            |

## 3. Database changes

New tables: suppliers; purchase_orders/purchase_lines; goods_receipts/goods_receipt_lines; supplier_bills; expense_categories/expenses; invoices/invoice_lines; finance_payments; stock_transfers/stock_transfer_lines; stock_counts/stock_count_lines. Existing tables/data are preserved. No destructive reset was performed.

Composite tenant/business/branch foreign keys and RLS follow existing migrations. Supplier/category records are business-wide; financial and inventory records are branch-specific. Transfer RLS permits only source/destination visibility within the selected business. Header actor/finalizer/sender/receiver references point to authentication users. SQL checks enforce positive quantities, received limits, payment limits, valid states, supported accounts, distinct transfer branches and amount equations; indexes cover scope/time and document uniqueness. Receipt and payment rows have no runtime update/delete privilege.

Existing journal balance/immutability/closed-period triggers apply to new financial postings. Team access routines are SECURITY DEFINER with a fixed search path, explicit actor/scope checks and no PUBLIC execution. Owners/self cannot be edited; managers cannot modify manager/owner access. Runtime connections remain non-owner, NOSUPERUSER and NOBYPASSRLS.

## 4. Permission changes

Server authorization reloads and locks membership in every scoped transaction. Client role values never authorize operations. Industry module checks remain independent of navigation. Naming follows existing singular conventions (`supplier.read`, `purchase.receive`, etc.). The generated matrix below is the actual final domain grant map. Business/branch membership and enabled modules further restrict these grants.

| Role       | Granted permissions                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| owner      | supplier.read, supplier.create, supplier.update, purchase.read, purchase.create, purchase.approve, purchase.receive, payable.manage, expense.read, expense.create, expense.reverse, invoice.read, invoice.create, invoice.issue, invoice.payment, finance.read, stock.transfer, stock.count, team.update, business.manage, catalog.read, catalog.write, stock.receive, sale.create, sale.read, sale.refund, cash.manage, customer.read, customer.write, report.read, journal.read |
| manager    | supplier.read, supplier.create, supplier.update, purchase.read, purchase.create, purchase.approve, purchase.receive, payable.manage, expense.read, expense.create, expense.reverse, invoice.read, invoice.create, invoice.issue, invoice.payment, finance.read, stock.transfer, stock.count, team.update, business.manage, catalog.read, catalog.write, stock.receive, sale.create, sale.read, sale.refund, cash.manage, customer.read, customer.write, report.read, journal.read |
| cashier    | catalog.read, sale.create, sale.read, cash.manage, customer.read, customer.write                                                                                                                                                                                                                                                                                                                                                                                                  |
| inventory  | catalog.read, catalog.write, stock.receive, purchase.read, purchase.receive, stock.transfer, stock.count                                                                                                                                                                                                                                                                                                                                                                          |
| purchasing | catalog.read, supplier.read, supplier.create, supplier.update, purchase.read, purchase.create, purchase.approve, purchase.receive                                                                                                                                                                                                                                                                                                                                                 |
| accountant | purchase.read, supplier.read, payable.manage, expense.read, expense.create, expense.reverse, invoice.read, invoice.create, invoice.issue, invoice.payment, finance.read, catalog.read, sale.read, customer.read, report.read, journal.read                                                                                                                                                                                                                                        |
| viewer     | catalog.read, sale.read, report.read, supplier.read, purchase.read, invoice.read, expense.read, finance.read                                                                                                                                                                                                                                                                                                                                                                      |

Viewer is an auditor-style template with read-only financial access; it has no writes. Inventory can receive/count/transfer and see stock costs but cannot manage AP/payments or general financial statements. Purchasing can manage suppliers/orders/receipts but not supplier payments. Accountant can issue stock-backed invoices as a financial workflow; it cannot create POS sales or process refunds by default.

## 5. Financial logic

All amounts are whole BIF strings/BigInt and PostgreSQL numeric(20,0); quantities are numeric(18,3), validated and scaled to thousandths. Line amounts round to nearest whole BIF using the existing domain helpers. No second valuation system was introduced.

| Event                        | Debit                                        | Credit                               |
| ---------------------------- | -------------------------------------------- | ------------------------------------ |
| Purchase receipt             | 1200 Inventory                               | 2100 Goods received not billed       |
| Receipt-backed supplier bill | 2100 Goods received not billed               | 2000 Accounts payable                |
| Supplier payment             | 2000 Accounts payable                        | 1000 Cash or 1010 Bank               |
| Expense                      | 6000 Operating expenses                      | 1000 Cash or 1010 Bank               |
| Expense reversal             | Original payment account                     | 6000 Operating expenses              |
| Credit invoice issue         | 1300 Accounts receivable; 5000 Cost of sales | 4000 Sales; 1200 Inventory           |
| Customer payment             | 1000 Cash or 1010 Bank                       | 1300 Accounts receivable             |
| Transfer send                | 1250 Inventory in transit                    | 1200 Inventory                       |
| Transfer receive             | 1200 Inventory                               | 1250 Inventory in transit            |
| Count loss/gain              | 5200 Stock variance / 1200 Inventory         | 1200 Inventory / 5200 Stock variance |

The existing application has named ledger accounts rather than configurable account master records; these additions extend that convention. They do not change existing sales/returns accounts. Purchases are not expensed when paid. Received-but-unbilled goods remain a liability in account 2100 until billing.

Weighted-average cost remains balance value divided proportionally across available quantity. Receipts accumulate rounded line cost, so multiple partial receipts exhaust the PO's exact rounded total. A last fractional receipt may carry zero incremental BIF value; it still records quantity/history, with no zero-line journal or zero liability. Sales/invoice issues allocate current balance cost; restockable POS returns use original captured sale cost. Offline negative-stock valuation remains a pre-existing explicit blocker to new valued movements.

P&L uses posted journal debits/credits: net revenue (4xxx), less 5000 COGS = gross profit; less 5100/5200 stock losses/variances and 6xxx operating expenses = net operating profit. Linked POS invoices produce no second revenue. Provisional offline cost is flagged. Product performance combines POS sales, issued independent invoices and POS returns. Previous-period comparison uses the same journal-derived endpoint for the preceding equal-length date range. Branch performance reauthorizes each branch membership independently and shows only this business’s branches with financial-report permission. Supplier/customer balances derive from authoritative totals minus payments.

Cash/bank movement is period movement from ledger accounts, not an absolute cash position. New financial payments are business treasury transactions outside the POS register; they intentionally do not alter a cashier's drawer expectation. Electronic POS payment evidence remains in its existing unverified clearing account and is not counted as verified cash.

## 6. Known limitations

- This increment does not fulfill every acceptance item in the original specification. In particular, full Team V2, advanced financial reporting and all-role manual QA remain unfinished; do not present this as the full platform.
- Financial recognition uses journal posting time. Expense/bill/invoice issue dates must be today's **business** date. Backdated/future accounting recognition needs an explicit accounting-date migration. PO document dates/due dates remain available.
- No tax engine/tax calculation was added because existing POS does not support tax lines. Amounts here are reviewed whole-BIF amounts without tax breakdown.
- Bills are receipt-backed and exact-value, one per receipt. Standalone service bills, price variances, credit notes, supplier returns, liability cancellation/reversal and payment reversal need additional reviewed workflows. Already received POs cannot be cancelled.
- Issued invoices cannot be voided/edited; credit-note/return allocation for credit invoices is deferred. Only drafts can be voided. Linked paid POS invoices capture the original amount; later POS returns remain on the original receipt and do not rewrite the invoice snapshot.
- Expense correction uses audited reversal/re-entry. Expense approval chains and payable/invoice payment reversals are not implemented.
- AR/AP/inventory are current balances, not historical as-of statements. Financial overview defaults to the selected branch and offers an authorized-branch performance table and previous-period comparison. It does not provide a balance sheet, cash-flow statement, aging buckets or financial CSV export; branch summaries include only branches for which the actor has financial-report access. Existing POS report exports remain available. Inventory in transit is journaled but not included in destination on-hand until receipt.
- Team supports create, role update and deactivate/reactivate in the selected branch. Name/email editing, dedicated transfer-of-branch UI, invitation/password reset delivery, custom role editors and approval chains are not added. Existing-email membership creation supports explicit multiple-branch access; owner changes are intentionally excluded.
- New operational panels use existing design components but their labels are currently English. Full French localization, exhaustive accessibility/device QA, native new-module screens, printer/scanner hardware and production deployment are unverified.
- Some list/reference pickers are bounded (first 30 suppliers, first 100 products/customers/receipts); large-catalog searchable reference selection/pagination needs follow-up. Financial history/report queries should gain pagination for large production datasets. A bill creation control may remain visible after a receipt is billed; the API's unique constraint rejects duplicates.
- Normal Prisma native-engine download is denied by current network policy. The current generated client was produced using the package's bundled WASM path, without disabling TLS/checksum verification, and is usable. The reusable install checks exact canonical schema/client version before reusing it. `binaries.prisma.sh` is saved in the network draft for future schema regeneration; that setting must be applied before a native-engine download can succeed.

## 7. Deferred industry functionality

Variants, batches/expiry, recipes/kitchen display, full reservations/folios, construction budgets/projects, property leases/rent, memberships, scheduling, repair/service jobs and fiscal integrations remain deferred. Shared records reference existing product, customer, branch and business identities so these modules can integrate later. Restaurant/accommodation behavior was not rewritten.

## 8. Manual verification

See [MANUAL_VERIFICATION_CHECKLIST.md](MANUAL_VERIFICATION_CHECKLIST.md) for exact owner, manager, cashier, inventory, purchasing, accountant and auditor scenarios, isolation checks, arithmetic, UI and historical-data checks. Automated checks do not establish that all manual items have been completed.

## 9. Commands run and outcomes

| Command/check                                             | Result                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Baseline `pnpm test`                                      | 9 passed before feature changes                                                                                                                                                                                                            |
| Baseline `pnpm test:integration`                          | 11 passed before feature changes                                                                                                                                                                                                           |
| `pnpm install --frozen-lockfile`                          | Passed, dependency integrity/supply-chain policy retained; lockfile unchanged                                                                                                                                                              |
| `pnpm db:generate`                                        | Client generated successfully using bundled WASM; normal native-engine download remains policy-blocked pending the saved domain setting                                                                                                    |
| `pnpm db:migrate`                                         | All 12 existing plus 4 additive migrations applied; repeat run passed with checksum verification                                                                                                                                           |
| `pnpm db:seed`                                            | Fictional data prepared; repeat install/seed passed without resetting existing records                                                                                                                                                     |
| `pnpm test:integration`                                   | 35 passed: 24 new core tests plus 11 existing integration tests                                                                                                                                                                            |
| `pnpm test:review`                                        | 6 passed, including offline, document/team, restaurant and accommodation regressions                                                                                                                                                       |
| `pnpm check`                                              | API/shared/web/mobile TypeScript, lint, import boundaries and 9 domain/offline tests passed; final rerun passed                                                                                                                            |
| `pnpm test:http`                                          | 4 passed in separate suites; initial expanded concurrent run hit real auth throttling, so the runner now separates suites by 11 seconds rather than disabling the limiter                                                                  |
| `node scripts/core-browser-smoke.mjs`                     | Supplier → PO → receipt → bill; invoice → partial payment; expense → report; cashier denial; inventory navigation; refresh and mobile overflow checks passed. Final browser rerun also passed branch-performance and prior-period controls |
| `pnpm build`                                              | Web production build passed; final rerun passed                                                                                                                                                                                            |
| `bash scripts/cloud-install.sh`                           | Repeated frozen install, matching-client verification, migrations and seed passed                                                                                                                                                          |
| `bash scripts/cloud-start.sh`                             | Stopped/restarted own API/web processes using saved helper; local readiness passed                                                                                                                                                         |
| `bash -n scripts/cloud-install.sh scripts/cloud-start.sh` | Passed                                                                                                                                                                                                                                     |
| `git diff --check`                                        | Passed; imported application files remain uncommitted; .env/.data/node_modules ignored                                                                                                                                                     |

The initial Prisma checksum URL was blocked; checksum/TLS checks were not disabled. An early movement test exposed PostgreSQL upsert create-branch validation for a negative proposed row; explicit locked update/create fixed it, and the full integration suite passed afterward. Other initial syntax/test-selector failures were corrected and rerun. No failed assertion was removed to obtain a pass.

Final automated totals: 9 domain/offline tests, 35 integration tests (24 new + 11 existing), 6 review regression tests, and 4 HTTP acceptance tests passed. The final exact-margin correction was additionally verified by rerunning all 24 new core tests. No tests were skipped or marked expected-failure. The browser smoke scenarios passed; the manual checklist and native/device checks remain unrun. The final production build completed successfully (Webpack compilation, TypeScript, static generation and build tracing).

The saved startup script was exercised after stopping the development processes, and HTTP services became ready again. Environment draft persistence is confirmed for install_script, start_skill and the binaries.prisma.sh network addition. Runtime network policy still excludes that domain; native-engine download remains blocked until settings are applied. Current application startup/testing uses the retained matching generated client.

PostgreSQL 17.11 was installed locally from signed Debian packages because PostgreSQL was absent. The archive documents PostgreSQL 16.14; compatibility of this implementation was exercised on 17.11, not a second 16.14 server. Runtime Node is 24.22.1 and pnpm 11.25.0; manifests request Node >=24 and record pnpm 11.5.0. Dependency declarations and lockfile were not relaxed.

## 10. Remaining technical risks

Review accounting policy/account codes for the intended jurisdiction before production. Test real industry configurations and larger datasets; provision independent identities for all role templates. Exercise real concurrent clients, network interruption/retry UI, print output and historical data. Review any live email/payment/provider integrations separately; none were configured or invoked for external delivery. No deployment, Git commit/push, environment publication or fresh-task restoration was performed. Reusable installation/start instructions and the required binaries.prisma.sh destination were saved to the environment draft; review/save those settings and publish through the product when ready. Saving the draft does not apply the network setting or publish a snapshot.
