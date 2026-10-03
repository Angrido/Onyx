#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="$ROOT/.onyx-data"
MODE="${1:-stub}"

case "$MODE" in
  stub) CLAUDE_BIN="$ROOT/packages/agent-runtime/bin/claude-stub.ts" ;;
  real) CLAUDE_BIN="$(command -v claude || printf 'claude')" ;;
  *)
    printf 'usage: dev-setup.sh [stub|real]\n' >&2
    exit 1
    ;;
esac

DEMO="$DATA/projects/demo"
mkdir -p "$DEMO/src"
write_demo_file() {
  if [ ! -f "$DEMO/$1" ]; then printf '%s\n' "$2" > "$DEMO/$1"; fi
}
write_demo_file package.json '{ "name": "demo", "type": "module" }'
write_demo_file src/math.ts 'export function add(a: number, b: number): number {
  return a - b;
}'
write_demo_file src/types.ts 'export interface Item {
  price: number;
  quantity: number;
}'
write_demo_file src/cart.ts 'import type { Item } from "./types";
import { add } from "./math";

export function total(items: Item[]): number {
  let sum = 0;
  for (const item of items) sum = add(sum, item.price * item.quantity);
  return sum;
}'
write_demo_file src/index.ts 'export * from "./types";
export { total } from "./cart";'
write_demo_file src/checkout.ts 'import { total, type Item } from "./index";

export function checkout(items: Item[]): string {
  return `Total: ${total(items)}`;
}'

pnpm --filter @onyx/mcp-server build

cat > "$ROOT/apps/api/.env" <<ENV
NODE_ENV=development
LOG_LEVEL=info
API_HOST=0.0.0.0
DATABASE_URL=file:$DATA/onyx.db
ONYX_DATA_DIR=$DATA
ONYX_PROJECTS_DIR=$DATA/projects
CLAUDE_BIN=$CLAUDE_BIN
ONYX_CHILD_ENV_PASSTHROUGH=CLAUDE_STUB_DELAY_MS
CLAUDE_STUB_DELAY_MS=400
ONYX_MCP_SERVER=$ROOT/packages/mcp-server/dist/onyx-mcp.js
ENV

DATABASE_URL="file:$DATA/onyx.db" pnpm --filter @onyx/db migrate:deploy

printf '\nDev environment ready in %s mode.\n' "$MODE"
printf 'Demo project: %s\n' "$DEMO"
printf 'Start everything with: pnpm dev\n'
printf 'Open the UI from any device on the network:\n'
printf '  http://localhost:3000\n'
for address in $(hostname -I 2>/dev/null); do
  case "$address" in
    *:*) printf '  http://[%s]:3000\n' "$address" ;;
    *) printf '  http://%s:3000\n' "$address" ;;
  esac
done
printf '  http://%s.local:3000 (with mDNS)\n' "$(hostname)"
