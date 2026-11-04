# DirectAdmin / CloudLinux deployment

This adapter runs the unchanged Nest domain services and Next web UI in one Passenger process. `app.cjs` is a CommonJS bridge to the ESM server; `/api/*` is dispatched directly to Nest. It does not introduce a second financial implementation. Next uses a custom server with a normal production build, not standalone output. A fresh CSP nonce is supplied to dynamically rendered pages; credentials and local data are excluded from the archive.

Target inspected: mybusiness.atziltech.com, DirectAdmin account atzilte28, CloudLinux Node 24.15.0, PostgreSQL plugin (client 13.23). Existing applications remain separate. The original subdomain root was inside the main website and inherited its canonical redirect and CSP. Use a dedicated document root outside `/domains/atziltech.com/public_html` and a separate private application directory.

## Prepare

```sh
MYBUSINESS_HOSTING=passenger pnpm build
pnpm exec tsc -p deployment/directadmin/tsconfig.json
node deployment/directadmin/package-release.mjs
```

The default release directory must not already exist; use MYBUSINESS_RELEASE_DIR to select another path. In the release directory, generate the artifact-specific npm lockfile and install production dependencies with `npm ci --ignore-scripts --legacy-peer-deps --no-audit --no-fund`; run `node install-prisma.cjs` to install the already generated Prisma client. Avoid installing native/mobile peer dependencies on the web host. Server dependencies are installed on the Linux host; never upload macOS node_modules. The development workspace continues to use its canonical pnpm lockfile.

## Runtime

CloudLinux settings: Node 24, Production, private root `mybusiness/app`, startup `app.cjs`, URL `mybusiness.atziltech.com/`. Runtime environment: DATABASE_URL for a non-owner application role; BETTER_AUTH_SECRET with fresh randomness; BETTER_AUTH_URL and WEB_ORIGIN both `https://mybusiness.atziltech.com`; ALLOW_REGISTRATION=false, ALLOW_DEMO_SEED=false. Migration credentials must not be in the runtime environment or public document root.

Create a new PostgreSQL database with separate migration owner and application roles. DB_RUNTIME_ROLE lets the checksummed SQL migration runner bind its logical `mybusiness_app` grants to a host-prefixed role. Role identifiers are allowlisted; source migration checksums are unchanged. Runtime must not own tables or have superuser/BYPASSRLS. Run migrations with owner credentials as a one-time command, then remove those credentials from the session. Check role attributes, RLS, FORCE RLS and direct-object denial before accepting traffic.

Use a fresh empty database or explicit fictional demo data. Do not copy the local .env, database directory, sessions, secrets or unrelated accounts to hosting. Bootstrap any requested account deliberately, with no email delivery implied. Existing posted records are never overwritten.

## Publish / rollback

Keep timestamped release archives and back up any existing subdomain index/.htaccess before replacing its routing. Register only the MyBusiness application. Do not restart, reconfigure or replace other apps. Test HTTPS, same-origin authentication, MFA enrollment, branch scope and a cash sale/return against the new database. To roll back code, restore the prior MyBusiness app root and Passenger settings; retain database history and use forward migrations. No production-readiness claim is implied by reaching a live login screen.
