#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$ROOT/.release}"

cd "$ROOT"
pnpm install --frozen-lockfile
pnpm turbo run build --filter=@onyx/api --filter=@onyx/web --filter=@onyx/mcp-server

rm -rf "$OUT"
mkdir -p "$OUT"

pnpm --filter @onyx/api deploy --prod --legacy "$OUT/api"
rm -rf "$OUT/api/dist"
cp -r apps/api/dist "$OUT/api/dist"

pnpm --filter @onyx/db deploy --legacy "$OUT/db"

mkdir -p "$OUT/web"
cp -r apps/web/.next/standalone/. "$OUT/web/"
mkdir -p "$OUT/web/apps/web/.next"
cp -r apps/web/.next/static "$OUT/web/apps/web/.next/static"
if [ -d apps/web/public ]; then
  cp -r apps/web/public "$OUT/web/apps/web/public"
fi

mkdir -p "$OUT/mcp"
cp packages/mcp-server/dist/onyx-mcp.js "$OUT/mcp/onyx-mcp.js"
cp packages/mcp-server/dist/onyx-statusline.js "$OUT/mcp/onyx-statusline.js"

mkdir -p "$OUT/deploy"
cp -r deploy/scripts deploy/systemd deploy/caddy deploy/env deploy/avahi deploy/nftables "$OUT/deploy/"
git -c safe.directory="$(pwd -P)" rev-parse --short HEAD > "$OUT/REVISION" 2>/dev/null || date +%Y%m%d%H%M%S > "$OUT/REVISION"

printf 'Release staged in %s (revision %s)\n' "$OUT" "$(cat "$OUT/REVISION")"
