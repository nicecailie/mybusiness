# MyBusiness

Connected business operations for Burundi, built as a TypeScript modular monolith with Next.js, NestJS, PostgreSQL/Prisma and Expo. This is an initial operational implementation, **not the complete platform or a production release**. Full scope and remaining gates are in [docs/PROGRESS.md](docs/PROGRESS.md).

## Working local slice

- Better Auth sign-in/out and revocable database sessions; explicit business/branch selection; server-enforced roles and PostgreSQL row security.
- Responsive French/English dashboard, product search/create/archive, opening stock, customer create/search, cash register open/close, POS, receipts, partial/restockable/damaged cash returns and immutable balanced journals.
- Cash sale, payment, stock, receipt, accounting, audit and outbox commit atomically. Retried commands return the original outcome. Monetary API values are strings; BIF arithmetic is exact.
- Native Expo app: sign-in, context switching, overview, catalog, payment evidence and receipts, SecureStore credentials, and actor/business/branch-partitioned SQLite drafts and a durable offline sale queue. Native completion and all-screen coverage remain unverified/incomplete.
- Reports derive from source records. No invented purchases, expenses or growth percentages. The fictional seed has two tenants, three branches, four operational roles and 21 connected sales.

## Prerequisites

Node 24.15.0, pnpm 11.5.0, PostgreSQL 16.14. Versions are pinned in manifests and pnpm-lock.yaml. Docker is an alternative; it was not installed on the development host. See [architecture decisions](docs/adr/0001-foundation.md), [design inventory](docs/DESIGN.md), and [dependency metadata](docs/DEPENDENCIES.md).

## Local startup

```sh
pnpm install --frozen-lockfile
```

Create a separate database owner and a non-owner runtime role named `mybusiness_app` with `NOSUPERUSER NOBYPASSRLS`. Copy `.env.example` to `.env`, set distinct database URLs and a random authentication secret, and set `ALLOW_DEMO_SEED=true` only for an isolated development database. Do not point seed/tests at production.

For a fresh local PostgreSQL cluster on this machine, the existing development setup uses port **55439**, data directory `.data/postgres`, and socket directory `.data/pgsocket`. It contains only fictional data. Start it if it is stopped:

```sh
pg_ctl -D .data/postgres -l .data/postgres.log -o '-p 55439 -h 127.0.0.1 -k /Users/arsene/Documents/apps/MyBusiness/.data/pgsocket' start
```

For a new checkout, initialize an isolated cluster with `initdb -D .data/postgres -A trust --no-locale -E UTF8` and start it on 55439; create `.data/pgsocket` first and use an absolute socket path for that checkout. Trust authentication is a **local demo convenience**; use password/SCRAM, private networking and TLS in deployed environments. `pnpm exec tsx scripts/local-env.ts` can then create the development database/runtime role and an ignored mode-0600 `.env` with random credentials; it refuses to overwrite an existing environment. It assumes the local PostgreSQL administrator matches the OS user, overridable with `PGUSER`.

```sh
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open **http://localhost:3000** (the configured origin). Sign in with `DEMO_OWNER_EMAIL` and `DEMO_PASSWORD` from your ignored `.env`; no password is embedded in source or printed in reports. Other demo users are `cashier@example.test`, `stock@example.test`, `accountant@example.test` and `second-owner@example.test`, using the same development-only password. Do not provision these accounts in production. API: http://127.0.0.1:4000/api/v1; OpenAPI: http://127.0.0.1:4000/api/docs.

In **Settings → Two-factor authentication**, confirm your password, add the displayed setup key to an authenticator app, save the recovery codes privately and verify a code. Setup secrets disappear when you leave the page; restart an interrupted setup. Completion signs out other sessions. Future sign-ins require an authenticator code or an unused recovery code. Native MFA enrollment remains unfinished.

Product creation can include a reviewed initial quantity/cost in the same transaction. Use Update stock for subsequent increases or decreases. Open a register, sell, inspect/print its receipt, and return eligible quantities. Product codes and prices can be edited without rewriting historical receipts; archived products can be restored. The seed owner's register is already open. This version has one register per branch and requires the actor's own active register for online checkout/refunds. [Review updates and validation](docs/REVIEW_UPDATES.md) document provisional offline sales, reconciliation, optional business documents, project-specific web dashboards and expanded report downloads.

## Native development

```sh
pnpm --filter @mybusiness/mobile dev
```

Set `EXPO_PUBLIC_API_URL` in the mobile process environment to the API's reachable address. On a physical device, localhost is the device; use a trusted development network and deliberately set `API_HOST` to the required interface. Use HTTPS and verified origins for deployment. Configure the Expo native scheme `mybusiness` and build a development client for SQLite/SecureStore. Simulator/device execution, secure-storage behavior, scanner/printer hardware and native MFA enrollment have not been verified. iOS Metro/Hermes export is a bundle check, not a native application build.

## Checks

```sh
pnpm format:check
pnpm check
pnpm test:integration
pnpm build
# With pnpm dev running:
pnpm test:http
pnpm --filter @mybusiness/mobile exec expo export --platform ios --output-dir ../../.data/native-export
```

Integration tests create isolated fictional test tenants in the configured development database; they leave their audit/financial records intact for inspection. They require `ALLOW_DEMO_SEED=true`. HTTP tests use the demo accounts, add a linked sale/return and revoke their test login session. Tests never use a privileged database role for application operations; the separate migration connection sets up fixtures only.

`pnpm build` uses Next.js's supported Webpack bundler because Turbopack's CSS worker could not bind a host port in this environment. CI configuration is supplied; hosted CI has not run. See [verification report](docs/VERIFICATION.md) for actual results and limits.

## Deployment and recovery

See [docs/OPERATIONS.md](docs/OPERATIONS.md). `compose.yaml` and `infra/Dockerfile` are templates, not verified deployments. Live providers, storage, full onboarding/invitations/recovery/MFA enforcement, all remaining business modules, device QA and fiscal validation are still required. No production deployment or external messaging was performed. Project distribution license is awaiting owner selection.
