# MyBusiness — Product and architecture context

Version: 1.0 | Prepared: 2026-10-27 | Status: development baseline with explicit proposals

## 1. How to use these documents

Read `context.md`, `requirements.md`, then `skills.md` before implementation. Keep all three at the repository root. `context.md` owns product context and architectural boundaries; `requirements.md` owns scope and acceptance criteria; `skills.md` owns engineering workflow and standards. They are project documentation, not installed agent skills.

Explicit user instructions and applicable repository instructions take precedence. Preserve existing working code. Record discrepancies rather than silently replacing architecture or expanding scope. When starting Codex, explicitly instruct it to read these files. Do not rely on arbitrary Markdown filenames being loaded automatically. A repository maintainer can reference them from the repository's agent entry instructions.

## 2. Confirmed project direction

- Product name: **MyBusiness**.
- Business management SaaS bringing CRM, eCommerce, accounting, inventory, point of sale and billing into one platform.
- The stated vision is a suite of open source business applications. The specific license and whether existing open source ERP modules will be reused have not been selected.
- Burundi is the initial market context.
- Mobile and tablet first; all major operations must work there. Desktop web complements them.
- Premium, carefully arranged interfaces with clear information, readable content and efficient workflows. Avoid generic template dashboards and decorative clutter.
- Rakuten is a requested reference for mobile behavior and visual quality. Adapt useful interaction patterns to business management; do not assume that a consumer shopping application's domain workflows define an ERP.
- Earlier conversations mention mobile and dashboard screenshots. Those images and the full earlier development prompt were not available when this baseline was written. Exact fonts, colors, measurements and screen matching remain unverified.

## 3. Product model and target users

Proposed implementation model: a tenant is a subscribing organization. A tenant owns one or more businesses; each business is a separate operational/accounting boundary with branches and stock locations. A user can hold memberships in multiple tenants. Every active screen shows the selected business and, where applicable, branch. Switching context must clear incompatible cached data and draft selections.

Initial users: business owners, managers, cashiers, inventory staff, accountants and sales staff. Separate platform operators manage SaaS operations. Customer storefront accounts, when introduced, have a separate authorization surface from staff accounts.

Primary outcome: a business can set up its catalog, receive stock, sell products, collect and reconcile payments, issue documents, see inventory and financial results, and control staff access without combining disconnected tools.

## 4. Proposed technical baseline

These are recommendations for a new repository, not claims about a previously approved stack. Inspect an existing repository before changing dependencies. Resolve mutually compatible stable versions when bootstrapping, pin them in manifests and a single lockfile, and record runtime versions. Do not copy old version numbers from unrelated projects.

| Area | Proposed choice | Responsibility |
| --- | --- | --- |
| Mobile/tablet | React Native, Expo, TypeScript, Expo Router | Native operational app on Android/iOS; adaptive tablet layouts |
| Web | Next.js App Router, React, TypeScript | Responsive staff dashboard and later storefront |
| Web styling | Tailwind CSS and accessible headless primitives | Custom MyBusiness component system |
| API | Node.js supported LTS, NestJS, REST/OpenAPI | Single authoritative business API |
| Database | PostgreSQL; Prisma with reviewed SQL migrations where needed | Transactions, relational constraints, tenant isolation |
| Workspace | pnpm workspaces | Shared contracts, configuration, domain utilities and tokens |
| Client data | TanStack Query; local state for transient UI | Server cache separate from local form state |
| Validation | Shared runtime schemas, e.g. Zod, plus database constraints | Boundary validation and typed contracts |
| Files | Private S3-compatible object storage | Product assets, attachments, exports |
| Background work | PostgreSQL transactional outbox and worker initially | Reliable notifications, exports and integrations |
| Local mobile data | SQLite for approved cache/draft/sync use cases | Controlled offline support |
| Testing | Unit runner, PostgreSQL integration tests, Playwright, native E2E runner | Domain, API, web and device verification |
| Delivery | Containers for API/worker/web where appropriate; CI; managed secrets | Repeatable builds and deployment |

Redis, a separate message broker, microservices, GraphQL, Kubernetes and AI features are not baseline dependencies. Introduce only for an evidenced requirement. Select a maintained authentication solution during foundation work; do not invent custom cryptography. Record the authentication choice in an ADR before implementation.

Official technical references checked on 2026-10-27: [Expo documentation](https://docs.expo.dev/), [Next.js documentation](https://nextjs.org/docs), [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html). These support platform capabilities, not a claim that the entire dependency combination has been tested.

## 5. Architecture

Use a **modular monolith** with separately deployable API and worker processes sharing domain code. Mobile and web call the same application services through the API. Web server components and route handlers must not create an alternative financial or stock implementation.

Suggested structure:

```text
apps/
  mobile/                 native phone and tablet app
  web/                    responsive staff web and later storefront
  api/                    HTTP transport and module composition
  worker/                 outbox consumers and scheduled jobs
packages/
  contracts/              runtime request/response schemas and API types
  domain/                 pure money, quantity and invariant utilities
  design-tokens/          semantic colors, typography and spacing
  ui-web/                 accessible web components
  ui-native/              native components using shared tokens
  config/                 lint, TypeScript and test configuration
modules/                  server-only bounded modules, or equivalent under api
  identity/ organizations/ catalog/ inventory/ sales/
  purchasing/ payments/ accounting/ crm/ commerce/ reporting/
  subscriptions/ audit/ notifications/
docs/adr/                 architecture decisions
infra/                    deployment templates and runbooks
```

Adapt physical directories to the repository; dependency boundaries matter more than folder names. Never ship server packages, secrets, ORM models or private business fields into client bundles.

Within a module: transport/controllers validate inputs; application services orchestrate use cases and transactions; domain logic enforces invariants; persistence/adapters perform IO. Domain code must not import UI or HTTP frameworks. Modules expose explicit services/contracts; forbid another module's private table writes and deep imports. A transaction coordinator can invoke several modules with the same transaction when atomicity is required.

Share domain rules and contracts across platforms. Share design tokens, not a forced universal component tree that degrades either platform.

## 6. Data ownership and isolation

| Module | Owns |
| --- | --- |
| Identity and organizations | Users, memberships, roles, grants, tenants, businesses, branches |
| Catalog | Products, variants, units, categories, price definitions |
| Inventory | Locations, immutable stock movements, reservations, counts, transfers |
| Sales | Quotes, sales orders, sale lines, fulfillment and returns |
| Purchasing | Suppliers, purchase orders, receipts, supplier bills |
| Payments | Payment records, allocations, provider attempts, cash sessions |
| Accounting | Accounts, periods, journals, invoices/credits and posting policies |
| CRM | Customers, contacts, leads, opportunities, activities |
| Commerce | Storefront publication, carts and checkout orchestration |
| Reporting | Read models derived from authoritative transactions |
| Subscriptions | SaaS plans and entitlements; separate from merchant sales |

Every tenant-owned row carries `tenant_id`; business-owned data also carries `business_id`. Tenant-safe composite keys/foreign keys prevent cross-tenant links. Tenant context comes from verified membership, never a trusted request-body value. Validate business and branch scope on every operation, including downloads, jobs and reports.

Use application authorization and PostgreSQL row-level security as complementary controls. Runtime database roles must not own tables or have `BYPASSRLS`; review `FORCE ROW LEVEL SECURITY` where applicable. Use transaction-local tenant context, including under connection pooling, with deny-by-default behavior when context is missing. Migration credentials are separate. Test row security using the runtime role, not only a privileged test connection.

Cache keys, object keys, job envelopes, idempotency records and sync cursors include tenant/business scope. Platform operator privileges must not imply unrestricted merchant data access.

## 7. Transaction and consistency rules

- Money uses exact decimal arithmetic and currency codes. Use PostgreSQL numeric and decimal strings across API boundaries; never JavaScript floating-point arithmetic for financial totals. Define scale and rounding per currency and document versioned tax rules.
- Quantity uses exact decimal values with declared unit precision; stock changes always produce movements.
- A sale finalization atomically records the sale, payment record/allocation as applicable, stock issue, accounting entry and outbox events. External provider settlement cannot be made atomic with a database transaction; use a pending-payment state and an idempotent reconciliation workflow.
- Stock updates use locking or an equivalent concurrency-safe reservation protocol. Default: prevent negative stock. Returns reference original sale lines and cannot exceed eligible quantities.
- Journals balance within each posting currency. Posted documents and movements are immutable; corrections use reversals/credit notes with reasons and references.
- Commit state and outbox events together. Deliver external effects after commit with retries and deduplication. Never claim exactly-once network delivery.
- Mutable documents use optimistic concurrency versions. Conflict responses preserve the user's draft and explain resolution options.
- Persist UTC timestamps; render with business timezone. Default proposal: Africa/Bujumbura. Business dates, due dates and accounting periods use explicit date semantics.

## 8. API and security boundaries

REST under `/api/v1`; documented OpenAPI contracts. Paginate lists, allowlist filtering/sorting, enforce bounds, and expose stable error codes, readable messages, field errors and correlation IDs. Use opaque stable identifiers, not array indexes. Never rely on obscurity of IDs for authorization.

Financial writes, stock mutations and provider callbacks require scoped idempotency. Reusing a key with the same canonical payload returns the original result; reuse with a different payload fails. Database uniqueness enforces deduplication under concurrent requests.

Use secure server-managed web sessions or appropriately designed secure cookies; defend cookie-authenticated writes against CSRF. Native credentials use OS secure storage. Implement session revocation, rate limits, tenant checks, secure reset/invitation flows and privileged-user MFA. Do not store authentication secrets in browser local storage or application logs.

Private uploads require authorization, type/size checks and malware handling before release; use short-lived signed download access. Require HTTPS, private database access, secret management, encryption at rest and tested backups. Audit sensitive mutations with actor, scope, action, entity, reason, timestamp and correlation ID; exclude secrets and unnecessary personal data.

## 9. Design direction

Use an original MyBusiness identity. References inform hierarchy, spacing, navigation, search, filters, form behavior and transitions. Do not copy Rakuten trademarks, assets or shopping/reward semantics without a MyBusiness requirement. Do not claim exact matching without access to the supplied screens.

Start with a restrained light interface, readable typography, a limited semantic color palette, consistent spacing and purposeful imagery. Exact branding is provisional until source assets are available. Avoid gradient-heavy metric cards, excessive shadows, unrelated illustrations and arbitrary charts.

Proposed phone navigation: Home, Sell, Inventory, Activity, More, filtered by permissions. Tablet uses a navigation rail and master/detail layouts where useful. Web uses a collapsible sidebar. Every major operation remains usable on a narrow phone; do not hide core functions behind desktop-only routes.

## 10. Open decisions and implementation policy

| Decision | Safe development default | Release dependency |
| --- | --- | --- |
| Exact design references and branding | Provisional tokens and accessible layouts | Visual sign-off before claiming reference fidelity |
| Framework versions and existing codebase | Inspect repository; verify compatibility; lock versions | Clean CI build |
| License / reuse of existing ERP | Inventory dependencies; no unilateral relicensing | Owner selects distribution license |
| Tax jurisdiction, invoice rules, account chart | Configurable demo rules, explicitly labeled | Validate local requirements with responsible domain expert |
| Payments and messaging providers | Sandbox adapters and manual payment recording | Credentials, contracts and verified live callbacks |
| Offline finalized transactions | Cache, local drafts, online finalization | Separate offline risk/reconciliation policy |
| SaaS plan prices and billing provider | Demo entitlements | Commercial decisions and integration |
| Payroll/statutory filing | Out of initial implementation | Dedicated requirements |
| Production hosting, retention, recovery targets | Environment templates and proposed targets | Operational approval and restore rehearsal |

Proceed on reversible implementation decisions without repeated questions. Ask only when a decision changes scope, correctness, legal/commercial obligations, irreversible data handling or a required external dependency. Never represent proposed details as previously approved user requirements.
