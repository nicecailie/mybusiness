#!/usr/bin/env bash
set -euo pipefail
cd /workspace/mybusiness
# Tasks already have isolated checkouts. Do not create another worktree.
pnpm install --frozen-lockfile
pg_bin=/workspace/.tools/postgres/usr/lib/postgresql/17/bin
if [[ ! -x "$pg_bin/postgres" ]]; then
  # Debian 13 cloud base. Signed APT metadata verifies the downloaded package hashes.
  tools_dir=/workspace/.tools
  mkdir -p "$tools_dir/apt/lists/partial" "$tools_dir/apt/cache/archives/partial"
  printf 'deb https://deb.debian.org/debian trixie main\n' > "$tools_dir/apt/sources.list"
  apt_opts=(-o "Dir::Etc::sourcelist=$tools_dir/apt/sources.list" -o Dir::Etc::sourceparts=- -o "Dir::State::lists=$tools_dir/apt/lists" -o "Dir::Cache=$tools_dir/apt/cache" -o Debug::NoLocking=1)
  apt-get "${apt_opts[@]}" update
  (cd "$tools_dir" && apt-get "${apt_opts[@]}" download postgresql-17 postgresql-client-17 libllvm19)
  for package in "$tools_dir"/*.deb; do dpkg-deb -x "$package" "$tools_dir/postgres"; done
fi
mkdir -p .data/pgsocket
if [[ ! -f .data/postgres/PG_VERSION ]]; then "$pg_bin/initdb" -D .data/postgres -A trust --no-locale -E UTF8; fi
# This cluster is local-only fictional development data, never a production database.
if ! "$pg_bin/pg_ctl" -D .data/postgres status >/dev/null 2>&1; then
  "$pg_bin/pg_ctl" -D .data/postgres -l .data/postgres.log -o '-p 55439 -h 127.0.0.1 -k /workspace/mybusiness/.data/pgsocket -c jit=off' start
fi
if [[ ! -f .env ]]; then pnpm exec tsx scripts/local-env.ts; fi
# Native-engine downloads require binaries.prisma.sh. Never disable checksum/TLS checks.
if ! node scripts/client-current.mjs; then pnpm db:generate; fi
pnpm db:migrate
pnpm db:seed
