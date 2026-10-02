#!/bin/sh
set -e

pnpm install --frozen-lockfile
pnpm exec nuxt prepare
pnpm exec node scripts/migrate.mjs
exec "$@"
