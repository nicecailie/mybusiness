# Foundation decisions — 27 October 2026

Sources read in full: root context.md, requirements.md, skills.md, supplied pasted brief, and all text in MyBusiness_Project_Specification.docx. No applicable AGENTS.md was found. There was no code, manifest, lockfile, or Git repository to preserve.

## Conflicts and resolution

The documents are product reference material; the user's request and root engineering requirements govern implementation. The pasted brief is more prescriptive than the proposed baselines. Decisions below are reversible defaults, not claims of prior approval.

- Tenant hierarchy: context proposes organization → businesses → branches; Word describes tenant = one legal business. Retain explicit tenant and business columns and composite foreign keys; seed one business per tenant. This supports both without consolidation or shared accounting.
- Queue: baseline proposes PostgreSQL outbox without Redis; pasted brief requests Redis/BullMQ. Retain transactionally committed outbox as source of truth; add a BullMQ delivery adapter when external delivery work is implemented. Do not create a second financial authority.
- Offline: Word/root baseline require online finalization; pasted brief also requests eligible provisional offline cash sales. Implement durable drafts first. Offline sale acceptance remains tracked work requiring enrolled devices, stock quotas, expiring authorization and conflict handling. No final receipt before server commit.
- Navigation: use Home, Sales, Sell, Reports, More from detailed brief; web uses grouped sidebar, tablets adaptive split view.
- Native delivery: adopt Expo per detailed brief over Word's optional PWA proposal.
- Recovery/performance numbers conflict across documents. None has been measured or accepted; preserve both proposals in scope tracking, do not claim an SLO.

## Stack and hosting

Use Next.js App Router, NestJS, PostgreSQL, Prisma, Expo, TypeScript and pnpm. Both clients call the Nest API; Next proxies it without duplicating domain rules. Local implementation and Docker deployment configuration preserve the explicitly requested stack. Sites Worker hosting cannot directly run the requested Nest/PostgreSQL TCP runtime, so do not substitute D1 or a static demo. No production deployment is implied by this development pass.

## Identity

Select Better Auth with its PostgreSQL adapter, email/password and TOTP plugin. Use library-managed hashing, sessions and secure cookies. Web uses same-origin API proxy; native uses SecureStore and the official Expo adapter. Disable public signup in deployed environments unless explicitly configured. Development provisioning is a separate explicit seed command; no production credentials in source. Recovery/invitation delivery requires a configured adapter; do not claim delivery without one. Privileged MFA enforcement must pass before M1 is considered complete.

## Finance

Initial demo business is BIF (zero decimal money units), integer product quantities, no tax configured. API uses decimal strings; domain uses BigInt with explicit scale. PostgreSQL NUMERIC stores exact values. Services must reject unsupported precision rather than round silently. Extend currency/quantity precision before enabling fractional units or additional currencies. No fiscal compliance claim. Opening inventory debits inventory/credits opening equity. Sale debits cash/credits revenue and debits cost of sales/credits inventory. Return reverses original price and cost. Manual mobile money is unverified, separate from cash and provider settlement.

## Scope sequence

Keep M0–M6 and all modules from the supplied brief. Implement tested vertical slices in order; a partially implemented gate stays open. Licensing remains owner decision; repository is private/unlicensed pending that decision. Do not copy ERP code.
