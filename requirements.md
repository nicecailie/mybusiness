# MyBusiness — Development requirements and acceptance criteria

Version: 1.0 | Prepared: 2026-10-27 | Status: proposed implementation baseline

## 1. Requirement status and scope

Confirmed direction: MyBusiness is a business management SaaS covering CRM, eCommerce, accounting, inventory, POS and billing; mobile/tablet first for Burundi; premium UI informed by the user's references. The detailed behaviors, roles, phases and numerical targets below are proposed engineering defaults, not a transcript of approved specifications. Read `context.md` for uncertainties and `skills.md` for implementation standards.

**MUST** indicates an acceptance condition within the selected milestone. It does not authorize implementing every milestone at once. **SHOULD** indicates a preferred behavior whose omission must be explained. **Deferred** means not part of initial delivery. Preserve the full product vision while implementing milestones in order.

Do not claim tax, payroll, invoice or accounting compliance from these documents alone. Production jurisdiction-specific rules require validated inputs; demo configurations must be clearly labeled.

## 2. Actors and permissions

Roles are permission bundles; checks use explicit actions and resource scopes. A tenant membership has allowed businesses/branches, with deny by default.

| Role | Proposed default access |
| --- | --- |
| Tenant owner | Organization setup, staff/roles, all permitted businesses, financial views, subscription management |
| Business manager | Assigned business operations and reports; no automatic ownership/billing control |
| Cashier | Assigned branch POS, own cash session and permitted receipts; refunds require a separate grant |
| Inventory staff | Catalog visibility, receipts/counts/transfers for assigned locations; no automatic financial access |
| Accountant | Invoices, allocations, journals, periods, reconciliation and financial reports |
| Sales/CRM staff | Assigned customers, quotes and pipeline; no unrestricted inventory or ledger adjustments |
| Platform operator | Tenant/service administration and operational health; explicit audited support access only |
| Storefront customer | Own account, orders and addresses only; introduced with commerce |

Proposed permission keys include `sale.create`, `sale.refund`, `price.override`, `stock.receive`, `stock.adjust`, `journal.post`, `period.close`, `report.financial.read`, `member.manage` and `subscription.manage`. Separate read/export permissions for sensitive data. The owner can configure roles without granting rights beyond the owner's own scope.

## 3. Primary journeys

1. **Start a business:** sign in → create organization/business → set currency/timezone → create branch/location → invite staff → add/import products → record opening stock → begin operations.
2. **Receive inventory:** select supplier → purchase order → partial/full receipt → stock movement → supplier bill/payment → payable and stock reports.
3. **Sell:** open cash session if required → find/scan product → cart → customer if needed → discount/tax calculation → payment → authoritative finalization → receipt → updated stock and accounts.
4. **Sell on credit:** create invoice with due date → post → record partial/full collection → allocate payment → inspect overdue balance.
5. **Return:** locate original sale → choose eligible quantities → reason and permission check → return disposition → credit/refund → reversal movements and reports.
6. **Manage remotely:** choose business/branch and period → view reconciled activity and alerts → drill into source transactions → export permitted results.

## 4. Functional requirements

### FND-01 — Identity, sessions and onboarding [M1]

Inputs: identity/contact credentials, organization and business names, currency, timezone, locale, branch/location details and invitation grants.

MUST support sign-in/out, recovery, expiring single-use invitations, session revocation and privileged-user MFA. Choose and document the identity provider/verification channel before implementation. Onboarding creates the tenant, owner membership, business and first branch consistently and resumes after interruption without duplicate creation.

Acceptance: an invited user sees only granted businesses; expired invitations fail safely; revoked sessions cannot continue writes; onboarding can be resumed; changing identity attributes follows verified provider rules. Missing live delivery credentials must be disclosed, with a clearly separate development adapter.

### ORG-01 — Organizations, branches and access [M1]

MUST create/edit/archive businesses, branches and stock locations with appropriate permissions; assign scoped roles; display active context; support a user in several organizations. Archiving must prevent new activity without breaking historical reporting. Currency changes after posting require a defined migration workflow and are blocked by default.

Acceptance: unauthorized direct API calls fail; concurrent context changes cannot mix data; disabled users lose access; cross-tenant foreign references are rejected by database constraints and API checks.

### CAT-01 — Catalog and import [M2]

Inputs: product name, SKU, optional barcode, category, stock/service type, unit and precision, selling price, cost policy, tax code, image and active status. Variants use distinct SKUs and stock identities where enabled.

MUST support search/filter, create/edit/archive, image upload and CSV import with preview, row errors and duplicate detection. Validate supported file sizes and maximum rows. Never partially import silently; return a clear accepted/rejected result and retry behavior. Preserve price/tax/product-description snapshots on historical transaction lines.

Acceptance: duplicate SKU/barcode policy is enforced within the declared business scope; invalid prices/units are rejected; archived items cannot enter new carts but remain in old receipts; Unicode/French product names and large catalogs work.

### INV-01 — Inventory ledger and stock control [M2]

Inputs: product, location, quantity, reason, reference document, cost basis and actor. Opening stock, purchase receipts, sales issues, returns, adjustments and transfers MUST produce immutable movements. Report on-hand, reserved and available separately. Define available = on-hand minus reserved for the initial model.

Use a documented weighted-average cost policy initially; negative stock is disallowed by default. Stock valuation and cost-of-goods postings must use the same policy. Returns use referenced original cost where available. Approval permissions apply to adjustments.

Transfer states: draft → dispatched → partially received/received; track in-transit quantity explicitly. Cancellation is allowed only before dispatch; after dispatch, use a compensating return/receipt workflow. Count sessions record expected and counted quantities and produce approved adjustments; concurrent movements must be handled by a recorded cutoff/version policy.

Acceptance: two simultaneous attempts to sell the last unit cannot both succeed; a transfer conserves total stock including in-transit; count adjustments are traceable; stock history reconciles to balances; duplicate receipts cannot add stock twice.

### PUR-01 — Suppliers and purchasing [M3]

Inputs: supplier/contact, order lines, agreed costs, tax, expected date, receiving location and payment terms. MUST support draft/confirmed/cancelled purchase orders, partial receipts and supplier bills. Receipt status and payment status are separate. Over-receipt is rejected unless explicitly permitted with an auditable reason.

Outputs: purchase order, goods receipt, stock movements, supplier bill and payable balance. Match bill and receipt quantities; expose discrepancies rather than silently treating them as correct. Returns to supplier reverse eligible stock and financial effects.

Acceptance: receiving 4 of 10 units leaves 6 outstanding; a repeated receipt request preserves a single effect; supplier payment reduces only allocated payable amounts; cancelled orders cannot receive stock.

### POS-01 — Sales and checkout [M2]

Inputs: branch/location, cashier/session, items/quantities, optional customer, permitted discount, payment method and tendered amount. Search and barcode entry MUST work with a manual fallback. Support a saved draft/held cart and a fast path for a normal cash sale.

Server calculates the authoritative subtotal, discounts, tax, total, paid amount, change and remaining balance. Discounts/price overrides require appropriate grants and reason where configured. Distinguish gross tendered cash from net cash retained after change.

States: draft → awaiting payment where applicable → completed; draft cancellation creates no stock or ledger effect. Completed sales are corrected through returns/credits, not deletion. Payment status and fulfillment status remain explicit when they differ.

Outputs: sale number, immutable line snapshots, receipt, payment allocation, stock movement and balanced journal. Finalization must be atomic for local records and idempotent. A timeout must show unknown/pending status and offer status lookup instead of inviting duplicate payment.

Acceptance: a successful sale survives restart; stock/ledger/report changes reconcile; retry returns the same sale; denied discounts fail server-side; insufficient stock preserves the cart; printable/shareable receipts use real completed data. Sharing requires a deliberate user action.

### CASH-01 — Cash sessions and reconciliation [M2]

MUST open a branch/register session with opening float, record authorized cash in/out with reasons, associate cash transactions, close with denomination/count totals and explain variances. Enforce the configured one-active-session-per-register policy.

Expected closing cash = opening float + net cash sales/collections + cash in − cash refunds − cash out. Separate noncash payments. Closing locks the session; reopening needs a privileged audited action or adjustment policy.

Acceptance: sessions reconcile from underlying movements; concurrent opening cannot duplicate a session; closed sessions reject new cash transactions; variance and actor remain visible.

### BILL-01 — Quotes, invoices and customer credit [M3]

Inputs: customer, lines, prices, discounts, tax, due date, currency, notes and source sale/quote. MUST create quotes, convert once to an order/invoice, save invoice drafts, post invoices, allocate payments and issue credit notes. Document numbering is unique and concurrency-safe per business and series; never promise legally gapless numbering without validated rules.

An invoice's lifecycle and collection status are separate: draft/posted/credited or reversed; unpaid/partially paid/paid/overdue derived from allocations and due date. Posting snapshots issuer/customer/tax details. Prevent the same sale from posting revenue twice through separate invoice conversion.

Acceptance: a partial payment leaves the correct balance; an overpayment is rejected or recorded explicitly as customer credit, never silently discarded; posted invoices cannot be edited; credit notes reference original eligible amounts; PDF/print output matches posted values.

### PAY-01 — Payments, allocations and refunds [M2 manual; M4 provider integration]

Manual cash, bank and mobile-money recording MUST identify method, amount, currency, date, actor and reference. Manual recording is not proof of provider settlement and must be labeled accordingly. Allocation totals cannot exceed available payment or document balances. Refunds cannot exceed eligible settled amounts.

For live providers: model initiated/pending/succeeded/failed/expired states according to provider semantics, verify signed callbacks, deduplicate, reconcile delayed events and make refunds independently traceable. Never mark settled from a client redirect alone. Do not handle raw card details in MyBusiness.

Acceptance: duplicate/out-of-order notifications do not double-book; timeout yields a recoverable pending state; reconciliation corrects verified provider status; provider failure cannot create a completed paid sale without a documented compensating flow.

### RET-01 — Returns and refunds [M2]

MUST locate the original transaction, select eligible quantities, record a reason, enforce permission, and choose restockable/damaged disposition. Returns and monetary refunds are separate linked actions. Reverse original eligible tax, discount and cost effects proportionally under the documented rounding policy.

Acceptance: prior returns reduce eligibility; damaged stock is not sellable; retries cannot duplicate credits/refunds; cash refunds affect the active authorized cash session; original documents remain intact.

### ACC-01 — Accounting foundation [M2 basic postings; M3 full bookkeeping]

Inputs: configurable chart of accounts, opening balances, posting mappings, fiscal periods and approved journal lines. MUST implement double-entry journals, posting dates, references, debit/credit balance checks, period locking and reversal entries. Sales, receipts, inventory valuation, cost of goods, purchases and payments use documented posting templates.

M3 adds receivables/payables aging, trial balance, general ledger, profit/loss, balance sheet and basic bank/cash reconciliation with unmatched-item review. Define cash/accrual basis clearly per report; do not mix bases. Initial proposal: one base currency per business; defer foreign-currency revaluation and cross-company consolidation.

Acceptance: unbalanced journals fail; closed periods reject postings; subledgers reconcile to control accounts; returns reverse appropriate original effects; reports drill into source transactions; opening balance setup balances and has an audit trail.

### CRM-01 — Customer records and pipeline [M2 directory; M4 pipeline]

Directory inputs: name, contact channels, optional address, notes and permitted identifiers. MUST support search, duplicate checks, transaction history and outstanding balances with role restrictions. Customers may be optional for walk-in sales but required for credit invoices.

M4 adds leads, configurable pipeline stages, opportunities, owners, expected value and dated activities. Define won/lost transitions and quote/order links. Do not send automated outreach without an approved communication feature and preferences.

Acceptance: customer balance matches ledger allocations; contact access respects permissions; repeated conversion does not duplicate customer/order records; archived contacts retain transaction history.

### COM-01 — eCommerce [M5]

MUST support publishable product listings, search/category filtering, product details, cart, checkout, order history and staff fulfillment. Define pickup/delivery coverage and shipping costs before enabling checkout. Storefront inventory/prices come from the same domain services as POS.

Reserve stock during the approved checkout window, expire reservations and reconcile payment/fulfillment. Guest versus registered checkout is a product decision; choose explicitly. Do not expose staff costs, supplier information or internal notes through public endpoints.

Acceptance: concurrent POS/storefront checkouts cannot oversell; expired carts release reservations; callbacks cannot create duplicate orders; customers see only their orders; cancellation/refund rules follow fulfillment and payment state.

### REP-01 — Dashboard, reports and exports [M2 onward]

MUST show scoped date range, business/branch, currency, timezone and freshness. Initial metrics: net sales, refunds, payment-method breakdown, receivables where enabled, low stock and top-selling items. Define net sales as completed sales less eligible returns for the chosen reporting basis; label tax inclusion explicitly. Do not label revenue as profit; profit requires cost data and a documented formula.

Charts need comparable periods and useful labels; avoid decorative charts without a decision use. Drill-downs and exports preserve filters and permissions. Large exports run in the background with expiring private downloads; neutralize spreadsheet formula injection.

Acceptance: metric values reconcile against source records; filters are consistent across cards/lists/exports; unauthorized financial metrics are omitted server-side; stale/offline data is labeled.

### MOB-01 — Mobile, tablet and offline behavior [M1 onward]

All major in-scope business operations MUST be usable on phone and tablet. Default localization proposal: French and English; BIF currency displayed with an appropriate local label such as FBu and explicit currency metadata. Keep translation strings outside components and verify date/number formats.

Initial offline scope: previously authorized cached reads and local drafts. Stock posting, sale completion, payment confirmation, role changes and journal posting require online server validation. Show offline, syncing, conflict and failed states; never issue a final receipt for an uncommitted draft. Persist drafts through app restarts, with explicit unsaved-change handling.

Deferred offline finalized sales require a separate policy for stock allocation, temporary numbering, price snapshots, device permissions, idempotency, conflicts and reconciliation. They must not be enabled implicitly.

Acceptance: losing connectivity preserves the draft; reconnect revalidates permissions/prices/stock before commit; switching business cannot reuse another business's cart; logout clears sensitive local state according to policy; pending drafts cannot be silently discarded.

### SAAS-01 — Platform administration and subscriptions [M1 tenant lifecycle; M5 billing]

MUST distinguish platform operators from tenant owners. Manage tenant lifecycle and service health with audit trails. M5 adds plans, entitlements, usage limits and subscription status through a selected provider or explicit manual administration.

Subscription billing is distinct from merchant customer invoicing. Suspension and grace periods require a documented policy; never delete business records because a subscription lapses. Feature entitlements are enforced by the API as well as UI.

Acceptance: trial/active/restricted states behave consistently; platform operators cannot silently impersonate staff; approved support access is time-bound and audited; billing retries cannot create duplicate subscriptions or charges.

### AUD-01 — Audit and notifications [M1 onward]

MUST audit access/role changes, postings, refunds, stock adjustments, imports/exports and period closure with tenant scope, actor, timestamp, entity and reason. Ordinary users cannot edit audit records. Keep security logs separate from user-visible activity where needed.

In-app notifications cover failed jobs, low stock and operational exceptions where enabled. External email/SMS/push requires a configured adapter, delivery status and retries; notification failure must not roll back a committed sale.

Acceptance: audit records trace a transaction across API and worker through correlation IDs; secrets are redacted; notification retries are bounded and deduplicated.

## 5. Screen inventory

Every screen needs loading, empty, error/retry, permission-denied and relevant offline states.

| Area | Required screens across milestones |
| --- | --- |
| Access | Sign in, recovery, invitation, MFA, organization switcher, onboarding |
| Home | Business overview, branch/date filters, alerts and drill-downs |
| Sell | Product search/scan, cart, held sales, payment, pending result, receipt |
| Sales | Transaction list/detail, returns, cash open/close and variance |
| Inventory | Catalog list/detail/editor, import preview, locations, movements, counts, transfers |
| Purchasing | Suppliers, purchase orders, receiving, bills and supplier payments |
| Billing | Quotes, invoice list/editor/detail, credit notes and allocations |
| Accounting | Accounts, journals, posting detail, periods, reconciliation and financial reports |
| CRM | Customers/detail/history, leads, pipeline and activities |
| Commerce | Product browse/detail, cart, checkout, order status and fulfillment |
| Administration | Businesses/branches, staff/roles, audit, preferences, integrations and subscription |
| Platform | Tenant lifecycle, service status and audited support access |

Phone navigation and tablet layouts must support these capabilities without reproducing a dense desktop table at phone width. Use role-specific entry points and progressive disclosure.

## 6. Nonfunctional acceptance criteria

These are proposed targets to validate against an agreed test environment before release.

| ID | Requirement and evidence |
| --- | --- |
| NFR-01 | Tenant isolation across database/API/cache/files/jobs/sync, tested with at least two tenants and multiple branches |
| NFR-02 | WCAG 2.2 AA target for web, native accessibility review, keyboard/focus support, screen-reader labels, scalable text and usable touch targets |
| NFR-03 | At 50 concurrent active test users, 10,000 SKUs and 100,000 sale lines per business: p95 ordinary API reads ≤500 ms and local sale-finalization API ≤1 s, excluding external provider/network latency; document hardware and workload |
| NFR-04 | Key phone screen interactive within 3 seconds on the selected representative Android device and measured mobile network profile; define device/profile in test report |
| NFR-05 | No acknowledged committed transactions lost on ordinary process restart; test crash/retry behavior. Disaster recovery proposal: RPO ≤24 hours and RTO ≤4 hours, validated by restore rehearsal and revisited before paid launch |
| NFR-06 | Structured redacted logs, correlation IDs, API latency/error metrics, job backlog monitoring, uptime checks and actionable alert ownership |
| NFR-07 | Private encrypted backups with retention policy, environment separation and a documented restore process; never copy production personal data into demo seeds |
| NFR-08 | Reproducible clean install/build, pinned dependencies, migration checks, secret/dependency scanning and no unresolved critical security findings |
| NFR-09 | Graceful network loss and server errors with preserved drafts, safe retries and no fabricated completion |
| NFR-10 | Localization, currency precision and business timezone tested across UI, receipts, API exports and reports |

## 7. Demo dataset

Use fictional data only. Provide at least two tenants for isolation checks, two branches for a sample business, owner/cashier/inventory/accountant roles, varied products and service items, customers, suppliers, receipts, completed and returned sales, partial payments, low stock and a closed period. Use recognizable Burundi-context examples and BIF values without claiming actual market prices or tax rates.

Seed deterministically; document development access without shipping fixed production passwords. Include edge cases such as a long French product name, zero stock, invalid import rows, partial receipt and refused cross-branch access.

## 8. Delivery milestones and exit gates

| Milestone | Deliverable | Exit gate |
| --- | --- | --- |
| M0 — Repository and decisions | Repository audit, architecture ADRs, design tokens/reference inventory, version matrix, CI and setup | Clean install/build; source of assumptions documented |
| M1 — Secure foundation | Identity, organization/branch scope, roles, shell navigation, audit and initial tenant lifecycle | Two-tenant isolation tests pass; responsive shell and invitations work |
| M2 — First operational release | Catalog, stock, basic customer directory, POS, cash/manual payment, receipt, returns, basic journal postings and dashboard | Full receive/opening-stock → sale → return flow reconciles on phone/tablet/web; concurrency and retry tests pass |
| M3 — Purchasing and bookkeeping | Purchasing, invoices/credit, allocations, periods, financial statements and reconciliation | Receivables/payables/stock reconcile to ledger; closed periods enforced |
| M4 — CRM and live adapters | Pipeline and selected payment/notification integrations | Sandbox E2E and failure/reconciliation tests pass; live configuration verified separately |
| M5 — Commerce and SaaS billing | Storefront, checkout/fulfillment, plans/entitlements and billing | Shared-stock concurrency, customer isolation and subscription lifecycle tested |
| M6 — Production readiness | Security/performance review, accessibility, restore rehearsal, monitoring, deployment and support runbooks | Release checklist and required domain/provider validations complete |

Implement M2 stock intake through opening stock and authorized receipts; complete purchase-order matching in M3. Do not build M2 financial transactions without their basic balanced postings just because full accounting screens arrive in M3.

## 9. Release blockers and excluded scope

Development can proceed with provisional defaults. Production launch requires validated invoice/tax/accounting configuration, chosen identity and payment channels, secrets, hosting/domain setup, recovery ownership, privacy/retention policy and licensing decision. The repository must list each unresolved dependency and its impact.

Deferred unless separately requested: statutory payroll, automated tax submission, intercompany consolidation, multi-currency revaluation, manufacturing/MRP, industry-specific hospital or banking workflows, advanced HR, loyalty/reward systems, AI assistants, custom hardware drivers, and finalized offline sales. Basic personnel access is included; payroll is not implied by user management.

## 10. Overall acceptance

MyBusiness is complete only for the declared milestone when its end-to-end workflows use persistent data, permissions hold across every surface, stock and finance reconcile, required tests pass, major operations work on mobile/tablet, and outstanding live dependencies are disclosed. A polished screenshot, seeded chart or clickable mockup does not satisfy these requirements.
