# Review updates — 29 October 2026

This change implements the supplied MyBusiness review in the existing NestJS, Next.js, Expo, PostgreSQL and SQLite application. It preserves the working authentication changes, business/branch isolation, cashier grants, immutable financial records and existing online stock protection. Nothing was deployed.

## Workflows

- **Native offline sales:** connect once on the Sell screen to register the device and download its catalog and register context. Select provisional offline recording when needed. SQLite commits the complete sale, its stable UUID, recorded payment evidence and the local stock estimate together; it removes the corresponding draft in that transaction. The queue survives restart and logout. Only the original actor/business/branch can see or upload it. Uploads run on startup, foreground and a 15-second interval when authenticated. Blocked uploads retain their payload and require action/retry. Synchronized records are never uploaded again merely because review is outstanding. Provisional receipts remain available from the queue.
- Catalog snapshots have device-, actor- and business-bound signatures. A stale legitimate product code/price remains usable for a completed offline sale; substituting another price fails review. This retains the existing cashier price permissions. Existing checkout has no discount-entry workflow; offline records explicitly store zero discounts and reject unauthorized nonzero discounts.
- **Products:** Product code, Low-stock alert level and Update stock replace the old labels in French and English. Creating a product and reviewed initial quantity is atomic. Edit keeps the product UUID and historical receipt snapshots. Operational references already use UUIDs. The archived filter exposes Restore. Update stock supports reviewed increases and decreases, with actor, time, reason and journal entries.
- Quantities use PostgreSQL `numeric(18,3)` and integer thousandths for financial calculations. SQLite estimates round each change to three places. Money remains whole BIF, with half-up rounding per sale line and proportional cumulative allocation on partial returns.
- **Payments:** cash, card and mobile money share the existing checkout. Lumicash, Ecocash and iHela require their provider and transaction/message reference. Receipts retain this evidence. Card/mobile records and refunds stay unverified; their journal debit/credit uses Payments awaiting verification rather than confirmed cash. No provider integration was added.
- **Managers:** Products contains stock reconciliation with opening availability, online/offline sales, quantities, current balances, status and correction history. Corrections link existing receipt refunds/reversals or record evidenced quantity corrections or outstanding fulfillment. No stock is created automatically. Settings exposes NIF, TVA, oversell policy, private documents and staff. Uploading a document revision retains its original and author/time. Staff use the existing credential/session/verification flow and receive membership in the selected business; they do not create another workspace. Initial passwords are not persisted in browser storage.
- **Registration/projects:** the first project plus zero, one or two additional projects map to separate existing business/tenant/branch contexts, each with its own activity. Optional NIF/TVA and up to three documents apply to the first project; each project's manager can complete details later in Settings. Provisioning all projects is transactional and retry-safe.
- **Web dashboards:** accommodation records rooms, guest profiles and non-overlapping stays. Chargeable nights equal checkout date minus check-in date; checkout day is not charged. Restaurant records food/drink orders, tables, unpaid/paid status and earnings. Payment posts through the existing checkout in the same transaction. Direct POS sales remain in the existing sales report. Retail retains its existing operational dashboard.
- **Exports:** existing week/month/custom range controls download business identity, summary and daily totals, receipts, payment references/status, stock movements, refunds, journals, corrections, stays and restaurant orders for the selected business/branch and period. Export reads use a consistent database snapshot and the same aggregate implementation as the display. Stay quotations are explicitly distinguished from received payments. Unresolved inventory valuation and payment evidence remain visible.

## Explicit shortage treatment and unresolved decision

For an authorized offline sale, inventory quantity may go negative. The sale consumes only the value of the available positive stock; unavailable units carry **pending valuation**, not an invented cost or a negative inventory asset. Sales/payment postings and known cost postings remain balanced. Receipts and reports flag pending valuation and provisional profit. Ordinary online checkout cannot consume a zero or negative balance.

A manager may record evidenced missing quantity up to the deficit, with zero _provisional_ value, through reconciliation. Valued surplus uses Update stock. This preserves the deficit's financial review instead of inventing an expense, purchase liability or opening equity. The business must still choose the final shortage valuation and counter-account policy (and its approval evidence). That decision is deliberately not automated. Operational resolution does not clear the separate valuation-pending flag.

## Validation and local database note

The existing development database's stored migration checksums do not match repository migrations. Its history was not repaired and its data was not reset. All new migrations were applied to a separately created local review database using `scripts/review-database.ts`.

Run local checks with:

```sh
pnpm check
pnpm build
node --import tsx scripts/review-database.ts pnpm db:migrate
node --import tsx scripts/review-database.ts pnpm test:integration
node --import tsx scripts/review-database.ts pnpm test:review
# With the isolated app running:
node --import tsx scripts/review-database.ts pnpm test:http
```

Automated coverage includes SQLite reopen/atomic rollback; parallel uploads and lost acknowledgement; an actual dropped HTTP connection after server commit; the 6 opening / 4 online / 6 offline / −4 inventory discrepancy; stock/code/price/archive/fractional workflows; receipt payment references; document revisions and business isolation; staff membership; three-project provisioning; room overlap/night calculation; restaurant payment atomicity; CSV totals/permissions; existing accounting and MFA checks. Browser QA exercises the changed product, business-document, project and dashboard flows at desktop/mobile sizes. Native Metro/Hermes export is a bundle check; actual iOS/Android device restart, SecureStore and SQLite runtime behavior still require device QA.

Validation completed successfully: `pnpm format:check`, `pnpm check`, `pnpm build`, 11 existing integration tests, 6 review acceptance tests, 3 HTTP tests and the iOS Metro/Hermes export. The full check includes 9 domain/SQLite tests, for 29 automated tests total. Twelve browser workflow checks passed with no browser runtime errors. The required oversell scenario and an actual connection loss after server commit passed. Browser screenshots and local QA results are retained under the ignored `.data/review-*` paths.
