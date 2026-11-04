# API contract

REST `/api/v1` is served by NestJS. Next.js proxies `/api/*`; it has no alternative stock or financial implementation. Interactive OpenAPI is served at `/api/docs` and JSON at `/api/docs-json`. Command request schemas are generated from the same Zod contracts used by the server. Typed response interfaces live in packages/contracts/src/index.ts. Full response-schema generation remains future contract work.

Authenticate through Better Auth `/api/auth/sign-in/email`; retain its secure session cookie with normal same-origin browser handling or the official Expo adapter. Never put credentials in localStorage. Sign-out revokes the server session. HTTPS production cookies are secure; select deployment origins deliberately. Privileged owner/manager/accountant domain operations in production reject identities without verified two-factor enrollment. Enrollment/recovery/invitation UI is not finished; do not deploy as a complete identity system.

`GET /api/v1/contexts` returns only current active memberships. Domain requests include `x-tenant-id`, `x-business-id`, `x-branch-id`; these are selections, never authority. Every service rechecks membership, role and scope. Cookie writes require the configured origin. Native sends the official adapter cookie and configured native origin.

| Path                   | Method    | Purpose                                                             |
| ---------------------- | --------- | ------------------------------------------------------------------- |
| health                 | GET       | Liveness only; not database/readiness proof                         |
| contexts               | GET       | Actor's granted businesses and branches                             |
| products               | GET, POST | Bounded search/page; create product without creating stock          |
| products/:id           | DELETE    | Archive; historical lines remain                                    |
| stock/opening          | POST      | Reviewed initial quantity/cost, stock movement and equity posting   |
| stock/movements        | GET       | Authorized paginated branch movements                               |
| customers              | GET, POST | Authorized paginated directory/create                               |
| cash-session           | GET, POST | Actor's active session / open branch register                       |
| cash-session/:id/close | POST      | Count, reason, expected balance and variance; locks session         |
| sales                  | GET, POST | Paginated branch sales / finalize cash sale atomically              |
| sales/:id              | GET       | Immutable source receipt, snapshots and returned quantities         |
| sales/:id/returns      | POST      | Eligible original lines, disposition, reason and linked cash refund |
| dashboard              | GET       | `from`, `to` ISO business dates; maximum 366 days                   |
| journals               | GET       | Authorized posted journal view                                      |
| audit                  | GET       | Authorized branch audit records                                     |
| reports/sales.csv      | GET       | Preserves branch/date scope, export permission and audit            |

Writes require `Idempotency-Key` (16–100 ASCII alphanumeric, underscore or hyphen characters; UUIDs work). Keys are scoped by actor, tenant, business, branch and command. Identical canonical input returns the saved result after commit; differing input with that key returns `IDEMPOTENCY_CONFLICT`. Unknown network results must retry the original payload/key, including the original cash session, rather than taking payment again. Clients persist pending payloads and operation IDs before sending.

Amounts cross the API as whole BIF decimal strings. Initial quantity precision is whole units. Price/cost and tax snapshots are authoritative server records, not client totals. Demo tax is unconfigured; no tax-compliance assertion. Sale POST accepts only product IDs/quantities, optional customer, gross cash tendered and cash session. It does not accept client price overrides, discounts, tenant ownership, final status or journal amounts.

Stable domain errors include `FORBIDDEN`, `UNAUTHORIZED`, `MFA_REQUIRED`, `VALIDATION_ERROR`, `IDEMPOTENCY_REQUIRED`, `IDEMPOTENCY_CONFLICT`, `INSUFFICIENT_STOCK`, `INSUFFICIENT_PAYMENT`, `PRODUCT_UNAVAILABLE`, `RETURN_EXCEEDS_SALE`, `CASH_SESSION_CLOSED` and `PERIOD_CLOSED`. Errors have code, safe message and requestId; validation can include fieldErrors. Failed operations do not return HTTP 200. Native/browser local storage remains untrusted and stored drafts are runtime-validated before display.

Current limits: no provider callbacks, bank/mobile-money settlement, allocations, general status mutation, financial editing or offline final posting endpoint exists. The outbox has committed records but no delivery worker. Catalog create's cost field is validated for the current contract but valuation is established exclusively by reviewed opening/receipt records; no stock or ledger value is implied by creating a product.
