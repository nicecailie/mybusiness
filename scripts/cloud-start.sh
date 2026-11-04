#!/usr/bin/env bash
set -euo pipefail
cd /workspace/mybusiness
pg_bin=/workspace/.tools/postgres/usr/lib/postgresql/17/bin
if ! "$pg_bin/pg_ctl" -D .data/postgres status >/dev/null 2>&1; then
  mkdir -p .data/pgsocket
  "$pg_bin/pg_ctl" -D .data/postgres -l .data/postgres.log -o '-p 55439 -h 127.0.0.1 -k /workspace/mybusiness/.data/pgsocket -c jit=off' start
fi
# Foreground command: run in a persistent terminal/session, then check readiness separately.
pnpm dev
