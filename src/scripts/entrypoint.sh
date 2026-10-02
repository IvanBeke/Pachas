#!/bin/sh
set -e
echo "[pachas] applying database migrations..."
node ./scripts/migrate.mjs
echo "[pachas] starting server..."
exec node .output/server/index.mjs
